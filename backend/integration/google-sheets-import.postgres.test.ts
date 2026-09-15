import { randomUUID } from 'node:crypto';
import { Pool, Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadMigrations, migrateDatabase } from '../scripts/migrate-database.mjs';

const state = vi.hoisted(() => ({ databases: [] as any[], next: 0 }));
// Inject real independent PostgreSQL pools into the canonical service. Neither
// numbering, duplicate lookup, transaction boundaries, nor audit is mocked.
vi.mock('../src/config/database', () => ({ db: new Proxy({}, { get: (_target, key) => {
    if (key === 'transaction') return (action: any) => state.databases[state.next++ % 2].transaction(async (tx: any) => {
        await tx.execute(sql`SET LOCAL ROLE simsa_api_runtime`);
        return action(tx);
    });
    const database = state.databases[0]; const value = database?.[key];
    return typeof value === 'function' ? value.bind(database) : value;
} }) }));
// These services are outside metadata-only import; any accidental file action
// fails instead of using storage or credentials. The optional producer is off.
vi.mock('../src/services/client-blob-upload.service.js', () => ({ clientBlobUploadService: {}, normalizeBlobLocator: (value: string) => value }));
vi.mock('../src/services/file-attachment.service.js', () => ({ default: {} }));
vi.mock('../src/services/srikandi-producer.service.js', () => ({ srikandiBusinessProducer: {
    suratMasukCreated: async () => {}, suratKeluarCreated: async () => {},
} }));
import { GoogleDriveImportService } from '../src/services/google-drive-import.service.js';

const url = new URL(process.env.TEST_POSTGRES_URL || 'http://invalid');
if (!['127.0.0.1', 'localhost'].includes(url.hostname)
    || !['simsa_test', 'simsa_import_test'].includes(url.pathname.slice(1))
    || !(url.port === '5432' || (Number(url.port) >= 40000 && Number(url.port) < 60000 && url.port !== '55432'))) {
    throw new Error('Google Sheets integration requires an isolated loopback test PostgreSQL target.');
}
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const databaseName = `simsa_import_test_${suffix}`;
const target = new URL(url); target.pathname = `/${databaseName}`;
const administrator = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
const pools = [0, 1].map(index => new Pool({ connectionString: target.toString(), max: 4,
    connectionTimeoutMillis: 5000, statement_timeout: 15000, query_timeout: 16000,
    application_name: `simsa-import-${suffix}-${index}` }));
let created = false;
const userId = randomUUID();
const audit = { userId, userEmail: `import-${suffix}@example.test` };

beforeAll(async () => {
    await administrator.connect();
    await administrator.query(`CREATE DATABASE ${databaseName} TEMPLATE template0`); created = true;
    const connection = await pools[0].connect();
    try {
        await connection.query(`DO $$ DECLARE role_name text; BEGIN
            FOREACH role_name IN ARRAY ARRAY['simsa_api_runtime','simsa_event_runtime','simsa_worker_runtime',
              'simsa_final_cleanup','simsa_maintenance','simsa_migrator','simsa_backup_reader'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT', role_name);
                END IF;
            END LOOP;
        END $$;
        CREATE EXTENSION pgcrypto;
        ALTER SCHEMA public OWNER TO simsa_migrator;
        CREATE SCHEMA drizzle AUTHORIZATION simsa_migrator;
        SET ROLE simsa_migrator;`);
        await migrateDatabase(connection, loadMigrations());
        await connection.query('RESET ROLE');
        await connection.query("INSERT INTO users(id,email,name,role,is_active) VALUES ($1,$2,'Synthetic importer','super_admin',true)", [userId, audit.userEmail]);
    } finally { connection.release(); }
    state.databases = pools.map(pool => drizzle(pool));
}, 60_000);

afterAll(async () => {
    await Promise.all(pools.map(pool => pool.end()));
    // This exact random database was created above, never the supplied target.
    if (created && /^simsa_import_test_[a-f0-9]{12}$/.test(databaseName)) await administrator.query(`DROP DATABASE ${databaseName}`);
    await administrator.end();
});

function sheet(kind: 'masuk' | 'keluar', number: string, rowNumber = '17') {
    return `Nomor Urut,No. Surat,Tanggal Surat,Perihal,${kind === 'masuk' ? 'Dari' : 'Kepada'}\n`
        + `${rowNumber},${number},2026-09-12,Permohonan data,Kantah sintetis`;
}
function service(csv: string) {
    const importer = new GoogleDriveImportService();
    vi.spyOn(importer, 'fetchSheetAsCSV').mockResolvedValue(csv);
    return importer;
}
const importRow = (importer: GoogleDriveImportService, kind: 'masuk' | 'keluar', unit: string, signal?: AbortSignal) => kind === 'masuk'
    ? importer.importSuratMasuk('synthetic-sheet', 'Data', unit, audit, { signal })
    : importer.importSuratKeluar('synthetic-sheet', 'Data', unit, audit, { signal });

describe('atomic Sheets import on real PostgreSQL transactions', () => {
    it.each([['masuk', 'SM-native'], ['keluar', 'SK-native'], ['masuk', '-'], ['keluar', '-']] as const)(
        'serializes concurrent %s number=%s and preserves soft-delete identity', async (kind, number) => {
            const unit = `import-${randomUUID().slice(0, 18)}`;
            await pools[0].query('INSERT INTO unit_kerja(id,name) VALUES ($1,$2)', [unit, 'Synthetic import unit']);
            await pools[0].query('INSERT INTO surat_templates(unit_kerja_id) VALUES ($1)', [unit]);
            const blocker = await pools[0].connect();
            await blocker.query('BEGIN');
            await blocker.query('SELECT 1 FROM surat_templates WHERE unit_kerja_id=$1 FOR UPDATE', [unit]);
            const attempts = [service(sheet(kind, number)), service(sheet(kind, number, '99'))].map(importer => importRow(importer, kind, unit));
            try {
                await expect.poll(async () => Number((await pools[1].query(
                    "SELECT count(*) AS count FROM pg_stat_activity WHERE datname=$1 AND application_name LIKE $2 AND wait_event_type='Lock'",
                    [databaseName, `simsa-import-${suffix}-%`],
                )).rows[0].count), { timeout: 5000 }).toBe(2);
            } finally { await blocker.query('COMMIT'); blocker.release(); }
            const results = await Promise.all(attempts);
            expect(results.reduce((sum, row) => sum + row.importedRows, 0)).toBe(1);
            expect(results.reduce((sum, row) => sum + row.duplicateRows, 0)).toBe(1);
            expect(results.every(row => row.success && row.skippedRows === 0 && row.errors.length === 0)).toBe(true);
            const records = (await pools[0].query(`SELECT * FROM surat_${kind} WHERE unit_kerja_id=$1`, [unit])).rows;
            expect(records).toHaveLength(1); expect(records[0].no_urut).toBe(1); expect(records[0].nomor_surat).toBe(number);
            expect(Number((await pools[0].query('SELECT count(*) FROM audit_log WHERE entity_id=$1 AND action=$2', [records[0].id, 'create'])).rows[0].count)).toBe(1);
            await pools[0].query(`UPDATE surat_${kind} SET is_deleted=true,deleted_at=now() WHERE id=$1`, [records[0].id]);
            expect(await importRow(service(sheet(kind, number, '400')), kind, unit)).toMatchObject({ importedRows: 0, duplicateRows: 1 });
            expect((await pools[0].query(`SELECT is_deleted FROM surat_${kind} WHERE unit_kerja_id=$1`, [unit])).rows).toEqual([{ is_deleted: true }]);
        }, 15_000,
    );

    it('rolls the surat back when its real audit insert fails, then permits a clean retry', async () => {
        const unit = `rollback-${suffix}`;
        await pools[0].query('INSERT INTO unit_kerja(id,name) VALUES ($1,$2)', [unit, 'Synthetic rollback']);
        const importer = service(sheet('masuk', 'SM-audit-fault'));
        const invalidAudit = { ...audit, userEmail: 'reject-import-audit@example.test' };
        await pools[0].query("ALTER TABLE audit_log ADD CONSTRAINT synthetic_import_audit_failure CHECK (user_email IS DISTINCT FROM 'reject-import-audit@example.test') NOT VALID");
        let result;
        try { result = await importer.importSuratMasuk('synthetic-sheet', 'Data', unit, invalidAudit); }
        finally { await pools[0].query('ALTER TABLE audit_log DROP CONSTRAINT synthetic_import_audit_failure'); }
        expect(result).toMatchObject({ importedRows: 0, skippedRows: 1, success: false });
        expect(Number((await pools[0].query('SELECT count(*) FROM surat_masuk WHERE unit_kerja_id=$1', [unit])).rows[0].count)).toBe(0);
        expect(await importRow(importer, 'masuk', unit)).toMatchObject({ importedRows: 1, duplicateRows: 0 });
    });

    it('keeps identity scoped to its source year and unit', async () => {
        const firstUnit = `year-${suffix}`, secondUnit = `other-${suffix}`;
        for (const unit of [firstUnit, secondUnit]) await pools[0].query('INSERT INTO unit_kerja(id,name) VALUES ($1,$2)', [unit, 'Synthetic identity unit']);
        const csv = sheet('masuk', 'SM-same-number');
        expect(await importRow(service(csv), 'masuk', firstUnit)).toMatchObject({ importedRows: 1 });
        expect(await importRow(service(csv.replace('2026-09-12', '2027-09-12')), 'masuk', firstUnit)).toMatchObject({ importedRows: 1 });
        expect(await importRow(service(csv), 'masuk', secondUnit)).toMatchObject({ importedRows: 1 });
        expect(Number((await pools[0].query('SELECT count(*) FROM surat_masuk WHERE unit_kerja_id=ANY($1::text[])', [[firstUnit, secondUnit]])).rows[0].count)).toBe(3);
    });

    it('cancels a disconnected import after waiting for the unit lock without inserting a row', async () => {
        const unit = `abort-${suffix}`;
        await pools[0].query('INSERT INTO unit_kerja(id,name) VALUES ($1,$2)', [unit, 'Synthetic disconnected import']);
        await pools[0].query('INSERT INTO surat_templates(unit_kerja_id) VALUES ($1)', [unit]);
        const blocker = await pools[0].connect();
        await blocker.query('BEGIN'); await blocker.query('SELECT 1 FROM surat_templates WHERE unit_kerja_id=$1 FOR UPDATE', [unit]);
        const caller = new AbortController();
        const attempt = importRow(service(sheet('masuk', 'SM-disconnected')), 'masuk', unit, caller.signal);
        try {
            await expect.poll(async () => Number((await pools[1].query(
                "SELECT count(*) AS count FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock'", [databaseName],
            )).rows[0].count), { timeout: 5000 }).toBe(1);
            caller.abort();
        } finally { await blocker.query('COMMIT'); blocker.release(); }
        expect(await attempt).toMatchObject({ success: false, importedRows: 0, skippedRows: 1 });
        expect(Number((await pools[0].query('SELECT count(*) FROM surat_masuk WHERE unit_kerja_id=$1', [unit])).rows[0].count)).toBe(0);
    });
});
