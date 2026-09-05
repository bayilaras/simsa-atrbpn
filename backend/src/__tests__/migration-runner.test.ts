import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
    loadMigrations,
    migrateDatabase,
    validateAppliedMigrations,
} from '../../scripts/migrate-database.mjs';

// Malformed manifests live only in this in-memory filesystem. Never rewrite
// reviewed SQL, historical hashes, or a configured database for these tests.
const virtualFiles = vi.hoisted(() => new Map<string, Buffer>());
vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return {
        ...actual,
        readFileSync: (path: string, options?: string | { encoding?: string }) => {
            if (typeof path !== 'string' || !path.includes('__simsa_migration_fixture__')) {
                return actual.readFileSync(path, options as any);
            }
            const bytes = virtualFiles.get(path);
            if (!bytes) throw new Error(`Missing fixture file: ${path}`);
            const encoding = typeof options === 'string' ? options : options?.encoding;
            return encoding ? bytes.toString(encoding as BufferEncoding) : Buffer.from(bytes);
        },
    };
});

const fixtureDirectory = resolve('__simsa_migration_fixture__');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fixturePath = (relative: string) => join(fixtureDirectory, relative);
const fixtureReadJson = (relative: string) => JSON.parse(virtualFiles.get(fixturePath(relative))!.toString());
function fixtureWrite(relative: string, value: string | Buffer) {
    virtualFiles.set(fixturePath(relative), Buffer.from(value));
}
function fixtureWriteJson(relative: string, value: unknown) {
    fixtureWrite(relative, JSON.stringify(value));
}
function prepareManifest() {
    virtualFiles.clear();
    const entries = Array.from({ length: 11 }, (_, index) => ({
        idx: index,
        when: 1_000 + index,
        tag: `${String(index).padStart(4, '0')}_fixture`,
        breakpoints: true,
    }));
    const legacy: Record<string, string> = {};
    for (const entry of entries) {
        const sql = `SELECT ${entry.idx};\n`;
        fixtureWrite(`${entry.tag}.sql`, sql);
        if (entry.idx < 10) legacy[entry.idx] = hash(sql.replaceAll('\n', '\r\n'));
    }
    fixtureWriteJson('meta/_journal.json', { entries });
    fixtureWriteJson('meta/approved_legacy_hashes.json', legacy);
}

function migration(index: number, statements: string[]) {
    const digest = hash(statements.join('--> statement-breakpoint'));
    return {
        tag: `${String(index).padStart(4, '0')}_transaction_fixture`,
        timestamp: 100 + index,
        hash: digest,
        acceptedHashes: [digest],
        statements,
    };
}

const smallChain = [
    migration(0, ['CREATE TABLE public.migrator_fixture (id integer PRIMARY KEY, value text NOT NULL)']),
    migration(1, ["INSERT INTO public.migrator_fixture VALUES (1, 'retained')"]),
];
const appliedRows = (chain = smallChain) => chain.map(item => ({
    hash: item.hash,
    created_at: String(item.timestamp),
}));

describe('reviewed migration filesystem manifest', () => {
    beforeEach(prepareManifest);

    it('loads every actual reviewed SQL file with its canonical and approved historical hashes', () => {
        const migrations = loadMigrations();
        const actualDirectory = resolve('src/db/migrations');
        const journal = JSON.parse(readFileSync(join(actualDirectory, 'meta/_journal.json'), 'utf8'));
        const legacy = JSON.parse(readFileSync(join(actualDirectory, 'meta/approved_legacy_hashes.json'), 'utf8'));
        expect(migrations).toHaveLength(34);
        for (const [index, item] of migrations.entries()) {
            const entry = journal.entries[index];
            const sql = readFileSync(join(actualDirectory, `${entry.tag}.sql`), 'utf8').replaceAll('\r\n', '\n');
            expect(item).toMatchObject({ tag: entry.tag, timestamp: entry.when, hash: hash(sql) });
            expect(item.acceptedHashes).toEqual(legacy[index] ? [hash(sql), legacy[index]] : [hash(sql)]);
            expect(item.statements.length).toBeGreaterThan(0);
        }
    });

    it('canonicalizes CRLF SQL and splits only the reviewed statement breakpoint', () => {
        fixtureWrite('0010_fixture.sql', 'SELECT 10;\r\n--> statement-breakpoint\r\nSELECT 11;\r\n');
        expect(loadMigrations(fixtureDirectory)[10]).toMatchObject({
            hash: hash('SELECT 10;\n--> statement-breakpoint\nSELECT 11;\n'),
            statements: ['SELECT 10;', 'SELECT 11;'],
        });
    });

    it.each([null, [], { entries: [] }, { entries: {} }])('rejects malformed journal shape %j', (journal) => {
        fixtureWriteJson('meta/_journal.json', journal);
        expect(() => loadMigrations(fixtureDirectory)).toThrow('non-empty ordered chain');
    });

    it.each([
        ['null entry', null],
        ['array entry', []],
        ['non-contiguous index', { idx: 9, when: 1_010, tag: '0010_fixture' }],
        ['timestamp collision', { idx: 10, when: 1_009, tag: '0010_fixture' }],
        ['string timestamp', { idx: 10, when: '1010', tag: '0010_fixture' }],
        ['fractional timestamp', { idx: 10, when: 1_010.5, tag: '0010_fixture' }],
        ['unsafe timestamp', { idx: 10, when: Number.MAX_SAFE_INTEGER + 1, tag: '0010_fixture' }],
        ['path traversal', { idx: 10, when: 1_010, tag: '0010_../../outside' }],
        ['wrong tag index', { idx: 10, when: 1_010, tag: '0011_fixture' }],
    ])('rejects %s before reading SQL outside the manifest', (_name, entry) => {
        const journal = fixtureReadJson('meta/_journal.json');
        journal.entries[10] = entry;
        fixtureWriteJson('meta/_journal.json', journal);
        expect(() => loadMigrations(fixtureDirectory)).toThrow('Invalid migration journal entry');
    });

    it.each([null, [], {}, Array.from({ length: 10 }, () => 'a'.repeat(64))])(
        'rejects malformed legacy allowlist shape %j', (legacy) => {
            fixtureWriteJson('meta/approved_legacy_hashes.json', legacy);
            expect(() => loadMigrations(fixtureDirectory)).toThrow('cover exactly 0000-0009');
        },
    );

    it.each(['missing', 'extra', 'uppercase', 'wrong digest'])('rejects %s legacy allowlist entry', (mode) => {
        const legacy = fixtureReadJson('meta/approved_legacy_hashes.json');
        if (mode === 'missing') delete legacy[9];
        else if (mode === 'extra') legacy[10] = 'a'.repeat(64);
        else legacy[0] = mode === 'uppercase' ? 'A'.repeat(64) : 'a'.repeat(64);
        fixtureWriteJson('meta/approved_legacy_hashes.json', legacy);
        expect(() => loadMigrations(fixtureDirectory)).toThrow();
    });

    it('rejects an allowlisted hash equal to the current canonical SQL', () => {
        const legacy = fixtureReadJson('meta/approved_legacy_hashes.json');
        legacy[4] = hash('SELECT 4;\n');
        fixtureWriteJson('meta/approved_legacy_hashes.json', legacy);
        expect(() => loadMigrations(fixtureDirectory)).toThrow('Historical migration hash no longer matches');
    });

    it('rejects an array digest instead of coercing it to a compatibility hash string', () => {
        const legacy = fixtureReadJson('meta/approved_legacy_hashes.json');
        legacy[4] = [legacy[4]];
        fixtureWriteJson('meta/approved_legacy_hashes.json', legacy);
        expect(() => loadMigrations(fixtureDirectory)).toThrow('cover exactly 0000-0009');
    });

    it.each([
        ['bare CR', Buffer.from('SELECT 10;\r')],
        ['psql command', Buffer.from('\\include other.sql\n')],
        ['malformed UTF-8', Buffer.from([0x53, 0x45, 0xff, 0x3b])],
    ])('rejects %s in SQL, including migrations outside the legacy allowlist', (_name, bytes) => {
        fixtureWrite('0010_fixture.sql', bytes);
        expect(() => loadMigrations(fixtureDirectory)).toThrow(/Unsupported migration|not valid UTF-8/);
    });

    it('rejects a missing SQL file', () => {
        virtualFiles.delete(fixturePath('0010_fixture.sql'));
        expect(() => loadMigrations(fixtureDirectory)).toThrow('Missing fixture file');
    });
});

describe('applied migration history is an exact accepted prefix', () => {
    it('returns all pending migrations for an empty ledger and none for a complete ledger', () => {
        expect(validateAppliedMigrations(smallChain, [])).toEqual(smallChain);
        expect(validateAppliedMigrations(smallChain, appliedRows())).toEqual([]);
    });

    it('returns only the remaining suffix of an exact prefix', () => {
        expect(validateAppliedMigrations(smallChain, appliedRows().slice(0, 1))).toEqual([smallChain[1]]);
    });

    it('accepts an explicitly approved historical hash without changing the ledger', () => {
        const legacyHash = 'b'.repeat(64);
        const chain = [{ ...smallChain[0], acceptedHashes: [smallChain[0].hash, legacyHash] }, smallChain[1]];
        const rows = [{ created_at: '100', hash: legacyHash }];
        expect(validateAppliedMigrations(chain, rows)).toEqual([smallChain[1]]);
        expect(rows[0].hash).toBe(legacyHash);
    });

    it.each([
        ['wrong hash', [{ created_at: '100', hash: '0'.repeat(64) }]],
        ['missing first migration', appliedRows().slice(1)],
        ['duplicate timestamp', [appliedRows()[0], appliedRows()[0]]],
        ['null timestamp', [{ created_at: null, hash: smallChain[0].hash }]],
        ['unknown newer timestamp', [{ created_at: '9000', hash: smallChain[0].hash }]],
        ['out-of-order history', appliedRows().reverse()],
    ])('rejects %s instead of skipping pending SQL by the latest timestamp', (_name, rows) => {
        expect(() => validateAppliedMigrations(smallChain, rows)).toThrow('chain diverges');
    });

    it('rejects a database newer than the checked-out journal', () => {
        expect(() => validateAppliedMigrations(smallChain.slice(0, 1), appliedRows())).toThrow('ahead of this release');
    });
});

describe('migration transaction boundary', () => {
    function fakeClient(preflight = {}, rows: unknown[] = []) {
        return {
            query: vi.fn(async (sql: string) => ({
                rows: sql.startsWith('SELECT current_user') ? [{
                    role: 'simsa_migrator', version: 170000,
                    public_owner: 'simsa_migrator', journal_owner: 'simsa_migrator',
                    ...preflight,
                }] : sql.startsWith('SELECT hash, created_at') ? rows : [],
            })),
        };
    }

    it('locks one transaction before preflight/history and commits SQL plus bound ledger values', async () => {
        const client = fakeClient();
        await expect(migrateDatabase(client, smallChain)).resolves.toEqual({ applied: 2, total: 2 });
        const queries = client.query.mock.calls.map(([sql]) => sql);
        expect(queries[0]).toBe('BEGIN');
        expect(queries[1]).toBe("SET LOCAL lock_timeout = '30s'");
        expect(queries[2]).toBe("SET LOCAL TIME ZONE 'UTC'");
        expect(queries[3]).toContain('pg_advisory_xact_lock');
        expect(queries.indexOf('LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE'))
            .toBeLessThan(queries.findIndex(sql => sql.startsWith('SELECT hash, created_at')));
        expect(queries.at(-1)).toBe('COMMIT');
        expect(queries.join('\n')).not.toMatch(/CREATE SCHEMA|\bGRANT\b|\bSET ROLE\b/i);
        expect(client.query).toHaveBeenCalledWith(
            'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
            [smallChain[0].hash, smallChain[0].timestamp],
        );
    });

    it.each([
        { role: 'postgres' },
        { role: 'simsa_api_runtime' },
        { public_owner: 'postgres' },
        { journal_owner: null },
        { journal_owner: 'unexpected_owner' },
        { version: 150000 },
    ])('refuses an unbootstrapped/unsafe connection %j before DDL', async (preflight) => {
        const client = fakeClient(preflight);
        await expect(migrateDatabase(client, smallChain)).rejects.toThrow('approved database role bootstrap');
        const queries = client.query.mock.calls.map(([sql]) => sql);
        expect(queries.at(-1)).toBe('ROLLBACK');
        expect(queries.join('\n')).not.toMatch(/CREATE TABLE|COMMIT|\bGRANT\b|\bSET ROLE\b/);
    });

    it('rolls back divergent history before executing any pending SQL', async () => {
        const client = fakeClient({}, [{ created_at: '100', hash: 'bad' }]);
        await expect(migrateDatabase(client, smallChain)).rejects.toThrow('chain diverges');
        expect(client.query).not.toHaveBeenCalledWith(smallChain[0].statements[0]);
        expect(client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    });
});

describe('isolated PostgreSQL-compatible migration execution', () => {
    let database: PGlite;

    beforeAll(async () => {
        database = new PGlite();
        await database.waitReady;
        await database.exec(`
            CREATE ROLE simsa_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
            GRANT simsa_migrator TO postgres;
            ALTER SCHEMA public OWNER TO simsa_migrator;
            CREATE SCHEMA drizzle AUTHORIZATION simsa_migrator;
            DO $$ BEGIN
                EXECUTE format('REVOKE CREATE ON DATABASE %I FROM PUBLIC, simsa_migrator', current_database());
            END $$;
            SET ROLE simsa_migrator;
        `);
    }, 30_000);

    beforeEach(async () => {
        await database.exec(`
            DROP TABLE IF EXISTS public.migrator_fixture;
            DROP TABLE IF EXISTS drizzle.__drizzle_migrations;
        `);
    });

    afterAll(async () => { await database?.close(); });

    it('applies fresh SQL and re-runs as a no-op without database CREATE', async () => {
        const privileges = await database.query<{ can_create: boolean }>(
            "SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS can_create",
        );
        expect(privileges.rows).toEqual([{ can_create: false }]);
        await expect(migrateDatabase(database, smallChain)).resolves.toEqual({ applied: 2, total: 2 });
        await expect(migrateDatabase(database, smallChain)).resolves.toEqual({ applied: 0, total: 2 });
        expect((await database.query('SELECT * FROM public.migrator_fixture')).rows)
            .toEqual([{ id: 1, value: 'retained' }]);
        expect((await database.query('SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows)
            .toEqual(smallChain.map(item => ({ hash: item.hash, created_at: item.timestamp })));
        expect((await database.query(
            "SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS can_create",
        )).rows).toEqual([{ can_create: false }]);
    });

    it('applies only a missing suffix and preserves prior data', async () => {
        await migrateDatabase(database, smallChain.slice(0, 1));
        await database.query("INSERT INTO public.migrator_fixture VALUES (9, 'prior')");
        await expect(migrateDatabase(database, smallChain)).resolves.toEqual({ applied: 1, total: 2 });
        expect((await database.query('SELECT id FROM public.migrator_fixture ORDER BY id')).rows)
            .toEqual([{ id: 1 }, { id: 9 }]);
    });

    it.each(['Asia/Bangkok', 'Pacific/Honolulu'])(
        'writes migration timestamps in UTC without changing the caller session timezone %s', async (zone) => {
            await database.query("SELECT set_config('TimeZone', $1, false)", [zone]);
            try {
                const chain = [migration(0, [
                    `CREATE TABLE public.migrator_fixture (
                        id integer PRIMARY KEY,
                        created_at timestamp DEFAULT now(),
                        expected_utc timestamp DEFAULT (current_timestamp AT TIME ZONE 'UTC'),
                        session_zone text DEFAULT current_setting('TimeZone')
                    )`,
                    'INSERT INTO public.migrator_fixture (id) VALUES (1)',
                ])];
                await expect(migrateDatabase(database, chain)).resolves.toEqual({ applied: 1, total: 1 });
                expect((await database.query(`SELECT
                    extract(epoch FROM (created_at - expected_utc))::integer AS drift_seconds,
                    session_zone FROM public.migrator_fixture`)).rows)
                    .toEqual([{ drift_seconds: 0, session_zone: 'UTC' }]);
                expect((await database.query("SELECT current_setting('TimeZone') AS zone")).rows)
                    .toEqual([{ zone }]);
            } finally {
                await database.query('RESET TIME ZONE');
            }
        },
    );

    it('restores the caller timezone when a migration transaction rolls back', async () => {
        await database.query("SET TIME ZONE 'Asia/Bangkok'");
        try {
            const chain = [migration(0, [
                'CREATE TABLE public.migrator_fixture (id integer PRIMARY KEY)',
                'INSERT INTO public.migrator_fixture (id) VALUES (1), (1)',
            ])];
            await expect(migrateDatabase(database, chain)).rejects.toThrow();
            expect((await database.query("SELECT current_setting('TimeZone') AS zone")).rows)
                .toEqual([{ zone: 'Asia/Bangkok' }]);
            expect((await database.query("SELECT to_regclass('public.migrator_fixture') AS fixture")).rows)
                .toEqual([{ fixture: null }]);
        } finally {
            await database.query('RESET TIME ZONE');
        }
    });

    it('rolls back all fresh DDL and ledger creation when a later statement fails', async () => {
        const broken = migration(1, ['INSERT INTO public.migrator_fixture VALUES (1, NULL)']);
        await expect(migrateDatabase(database, [smallChain[0], broken])).rejects.toThrow();
        expect((await database.query(`SELECT
            to_regclass('public.migrator_fixture') AS fixture,
            to_regclass('drizzle.__drizzle_migrations') AS ledger`)).rows)
            .toEqual([{ fixture: null, ledger: null }]);
    });

    it('retains an accepted historical ledger hash while applying a suffix', async () => {
        await migrateDatabase(database, smallChain.slice(0, 1));
        const historicalHash = 'b'.repeat(64);
        await database.query('UPDATE drizzle.__drizzle_migrations SET hash = $1', [historicalHash]);
        const compatibleChain = [
            { ...smallChain[0], acceptedHashes: [smallChain[0].hash, historicalHash] },
            smallChain[1],
        ];
        await expect(migrateDatabase(database, compatibleChain)).resolves.toEqual({ applied: 1, total: 2 });
        expect((await database.query('SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id')).rows)
            .toEqual([{ hash: historicalHash }, { hash: smallChain[1].hash }]);
    });

    it.each([
        ['bad hash', "UPDATE drizzle.__drizzle_migrations SET hash = 'unexpected'"],
        ['gap', 'UPDATE drizzle.__drizzle_migrations SET created_at = 101'],
        ['duplicate', `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
            SELECT hash, created_at FROM drizzle.__drizzle_migrations`],
        ['future timestamp', 'UPDATE drizzle.__drizzle_migrations SET created_at = 9000'],
    ])('rejects real ledger %s without altering existing data or evidence', async (_name, corruptLedger) => {
        await migrateDatabase(database, smallChain.slice(0, 1));
        await database.query("INSERT INTO public.migrator_fixture VALUES (9, 'prior')");
        await database.query(corruptLedger);
        const before = (await database.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
        await expect(migrateDatabase(database, smallChain)).rejects.toThrow('chain diverges');
        expect((await database.query('SELECT * FROM public.migrator_fixture')).rows)
            .toEqual([{ id: 9, value: 'prior' }]);
        expect((await database.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows).toEqual(before);
    });

    it('rolls back pending SQL when writing its ledger row fails', async () => {
        await migrateDatabase(database, smallChain.slice(0, 1));
        await database.query(`ALTER TABLE drizzle.__drizzle_migrations
            ADD CONSTRAINT fixture_reject_new_hash CHECK (hash <> '${smallChain[1].hash}')`);
        await expect(migrateDatabase(database, smallChain)).rejects.toThrow();
        expect((await database.query('SELECT * FROM public.migrator_fixture')).rows).toEqual([]);
        expect((await database.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows)
            .toEqual([{ count: 1 }]);
    });

    it('rolls back failed pending work while retaining an existing prefix and its data', async () => {
        await migrateDatabase(database, smallChain.slice(0, 1));
        await database.query("INSERT INTO public.migrator_fixture VALUES (9, 'prior')");
        const broken = migration(1, [
            "INSERT INTO public.migrator_fixture VALUES (1, 'must roll back')",
            'INSERT INTO public.migrator_fixture VALUES (2, NULL)',
        ]);
        await expect(migrateDatabase(database, [smallChain[0], broken])).rejects.toThrow();
        expect((await database.query('SELECT * FROM public.migrator_fixture')).rows)
            .toEqual([{ id: 9, value: 'prior' }]);
        expect((await database.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows)
            .toEqual([{ count: 1 }]);
    });
});
