import { randomUUID } from 'node:crypto';
import pg, { Client, Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadMigrations, migrateDatabase } from '../scripts/migrate-database.mjs';
import { applyPgTrgmPrivilegedStep } from './helpers/rangkaian-db.js';
import { startLatencyProxy } from './helpers/latency-proxy.js';

vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));
vi.mock('../src/services/client-blob-upload.service.js', () => ({ clientBlobUploadService: {}, normalizeBlobLocator: (value: string) => value }));
vi.mock('../src/services/file-attachment.service.js', () => ({ default: {} }));
vi.mock('../src/services/srikandi-producer.service.js', () => ({ srikandiBusinessProducer: {
    suratMasukCreated: async () => {}, suratKeluarCreated: async () => {},
} }));
import { dbState } from './helpers/db-proxy.js';
import { GoogleDriveImportService } from '../src/services/google-drive-import.service.js';
import { migrationService } from '../src/services/migration.service.js';

// Query budgets always run. The timed simulation runs only on request, through a
// latency proxy (one-way delay in ms) or, with 0, directly against the local cluster:
//   IMPORT_BENCH=1 IMPORT_BENCH_ONE_WAY_MS=110 IMPORT_BENCH_ROWS=40 npm run test:postgres-locks -- google-sheets-import-throughput
// The printed RTT is measured; timer granularity can make it larger than 2 × the delay.
const bench = process.env.IMPORT_BENCH === '1';
const benchOneWayMs = Number(process.env.IMPORT_BENCH_ONE_WAY_MS || 0);
const benchRows = Number(process.env.IMPORT_BENCH_ROWS || 40);

const url = new URL(process.env.TEST_POSTGRES_URL || 'http://invalid');
if (!['127.0.0.1', 'localhost'].includes(url.hostname)
    || !['simsa_test', 'simsa_import_test'].includes(url.pathname.slice(1))
    || !(url.port === '5432' || (Number(url.port) >= 40000 && Number(url.port) < 60000 && url.port !== '55432'))) {
    throw new Error('Import throughput tests require an isolated loopback test PostgreSQL target.');
}
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const databaseName = `simsa_import_test_${suffix}`;
const target = new URL(url); target.pathname = `/${databaseName}`;
const administrator = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
let created = false;
let pool: Pool;
const poolClosed: Promise<void>[] = [];
const userId = randomUUID();
const audit = { userId, userEmail: `throughput-${suffix}@example.test` };

// Every statement the import sends, including BEGIN/COMMIT/ROLLBACK, is one
// network round trip with node-postgres.
let queries = 0;
const originalQuery = pg.Client.prototype.query;
function countQueries() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pg.Client.prototype.query = function (this: any, ...args: any[]) { queries++; return (originalQuery as any).apply(this, args); } as any;
}

beforeAll(async () => {
    await administrator.connect();
    await administrator.query(`CREATE DATABASE ${databaseName} TEMPLATE template0`); created = true;
    const setup = new Client({ connectionString: target.toString() });
    await setup.connect();
    try {
        await setup.query(`DO $$ DECLARE role_name text; BEGIN
            FOREACH role_name IN ARRAY ARRAY['simsa_api_runtime','simsa_event_runtime','simsa_worker_runtime',
              'simsa_final_cleanup','simsa_maintenance','simsa_migrator','simsa_backup_reader'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT', role_name);
                END IF;
            END LOOP;
        END $$;
        CREATE EXTENSION pgcrypto;`);
        await applyPgTrgmPrivilegedStep(setup);
        await setup.query(`ALTER SCHEMA public OWNER TO simsa_migrator;
            CREATE SCHEMA drizzle AUTHORIZATION simsa_migrator; SET ROLE simsa_migrator;`);
        await migrateDatabase(setup, loadMigrations());
        await setup.query('RESET ROLE');
        await setup.query("INSERT INTO users(id,email,name,role,is_active) VALUES ($1,$2,'Synthetic importer','super_admin',true)", [userId, audit.userEmail]);
    } finally { await setup.end(); }
}, 60_000);

afterAll(async () => {
    pg.Client.prototype.query = originalQuery;
    await endPool();
    if (created && /^simsa_import_test_[a-f0-9]{12}$/.test(databaseName)) await administrator.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
    await administrator.end();
});

/** Connect as the API runtime role, through an optional latency proxy. */
async function usePool(port = Number(target.port)) {
    await endPool();
    const connection = new URL(target); connection.port = String(port);
    pool = new Pool({ connectionString: connection.toString(), max: 3, options: '-c role=simsa_api_runtime -c timezone=UTC' });
    pool.on('connect', client => { poolClosed.push(new Promise(resolve => client.once('end', () => resolve()))); });
    dbState.db = drizzle(pool);
}

/**
 * Pool.end() resolves once its clients are told to disconnect, not once they have. A session
 * still open when afterAll's forced DROP DATABASE runs is terminated (FATAL 57P01), and the
 * ended pool re-emits that as an uncaught 'error'; so also wait for every socket to close.
 */
async function endPool() {
    const ending = pool;
    pool = undefined as unknown as Pool;
    await ending?.end();
    await Promise.all(poolClosed.splice(0));
}

async function newUnit(label: string) {
    const unit = `${label}-${randomUUID().slice(0, 12)}`;
    const client = new Client({ connectionString: target.toString() });
    await client.connect();
    try { await client.query('INSERT INTO unit_kerja(id,name) VALUES ($1,$2)', [unit, 'Synthetic throughput unit']); }
    finally { await client.end(); }
    return unit;
}

/** An outgoing register like the real one: mostly numbered, some unnumbered rows identified by their link. */
function outgoingSheet(rows: number, start = 1) {
    const lines = ['Nomor Urut,No. Surat,Tanggal Surat,Perihal,Kepada,Get link'];
    for (let index = start; index < start + rows; index++) {
        const day = String((index % 28) + 1).padStart(2, '0');
        const numbered = index % 8 !== 0;
        lines.push([index, numbered ? `${index}/SK-600/IX/2025` : '-', `${day}/09/2025`, `Perihal sintetis ${index}`,
            numbered ? 'Kantah sintetis' : '', `https://drive.google.com/file/d/synthetic-${index}/view`].join(','));
    }
    return lines.join('\n');
}

function importer(csv: string) {
    const service = new GoogleDriveImportService();
    vi.spyOn(service, 'fetchSheetAsCSV').mockResolvedValue(csv);
    return service;
}

async function measure<T>(action: () => Promise<T>) {
    countQueries();
    queries = 0;
    const started = performance.now();
    try { return { result: await action(), queries, ms: performance.now() - started }; }
    finally { pg.Client.prototype.query = originalQuery; }
}

describe('Google Sheets import database round trips', () => {
    // Before the bulk lookup a duplicate row cost 5 round trips (BEGIN, template
    // upsert, template lock, identity lookup, ROLLBACK) and a new row 8.
    it('spends one round trip on the duplicates of a whole sheet and at most eight per new row', async () => {
        await usePool();
        const unit = await newUnit('budget');
        const rows = 24;
        const first = await measure(() => importer(outgoingSheet(rows)).importSuratKeluar('sheet', 'Data', unit, audit));
        expect(first.result).toMatchObject({ importedRows: rows, duplicateRows: 0, errors: [] });
        const again = await measure(() => importer(outgoingSheet(rows)).importSuratKeluar('sheet', 'Data', unit, audit));
        expect(again.result).toMatchObject({ importedRows: 0, duplicateRows: rows, errors: [] });
        console.info(`[import round trips] new: ${(first.queries / rows).toFixed(2)}/row, duplicate: ${(again.queries / rows).toFixed(2)}/row`);
        expect(again.queries).toBe(1);
        expect(first.queries).toBeLessThanOrEqual(1 + 8 * rows);
    }, 60_000);

    it('spends one round trip on the duplicates of a whole CSV file, in preview and import', async () => {
        await usePool();
        const unit = await newUnit('csv-budget');
        const rows = 24;
        const csv = ['Nomor Surat,Tanggal Surat,Perihal,Kepada',
            ...Array.from({ length: rows }, (_, i) => `${i + 1}/CSV/2025,2025-09-${String((i % 28) + 1).padStart(2, '0')},Perihal ${i + 1},Kantah sintetis`)].join('\n');
        expect(await migrationService.importSuratKeluar(csv, unit, audit)).toMatchObject({ imported: rows, errors: [] });
        const preview = await measure(() => migrationService.importSuratKeluar(csv, unit, audit, { dryRun: true }));
        const again = await measure(() => migrationService.importSuratKeluar(csv, unit, audit));
        expect(preview.result).toMatchObject({ valid: 0, duplicates: rows });
        expect(again.result).toMatchObject({ imported: 0, duplicates: rows });
        expect([preview.queries, again.queries]).toEqual([1, 1]);
    }, 60_000);

    it.runIf(bench)(`times ${benchRows} rows with ${benchOneWayMs} ms added each way`, async () => {
        const proxy = benchOneWayMs > 0 ? await startLatencyProxy({ host: target.hostname, port: Number(target.port) }, benchOneWayMs) : null;
        try {
            await usePool(proxy?.port);
            const unit = await newUnit('bench');
            // Warm the pool so connection setup is not billed to the first row, and measure the real RTT.
            await pool.query('SELECT 1');
            const probe = performance.now();
            for (let i = 0; i < 20; i++) await pool.query('SELECT 1');
            const rtt = (performance.now() - probe) / 20;
            const first = await measure(() => importer(outgoingSheet(benchRows)).importSuratKeluar('sheet', 'Data', unit, audit));
            expect(first.result).toMatchObject({ importedRows: benchRows, errors: [] });
            const again = await measure(() => importer(outgoingSheet(benchRows)).importSuratKeluar('sheet', 'Data', unit, audit));
            expect(again.result).toMatchObject({ importedRows: 0, duplicateRows: benchRows });
            console.info(`[import bench rtt=${rtt.toFixed(1)}ms rows=${benchRows}] new: ${(first.ms / benchRows).toFixed(1)} ms/row `
                + `(${first.queries} queries, ${(first.ms / 1000).toFixed(1)} s); duplicate: ${(again.ms / benchRows).toFixed(1)} ms/row `
                + `(${again.queries} queries, ${(again.ms / 1000).toFixed(1)} s)`);
        } finally { await endPool(); await proxy?.close(); }
    }, 1_800_000);
});
