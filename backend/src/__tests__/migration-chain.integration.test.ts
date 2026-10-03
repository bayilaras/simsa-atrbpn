import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '../db/schema/index.js';
import { enterTestMigratorRole } from './helpers/database-role-fixture.js';
import { P5_IDS, seedBerkasDiberkaskan, seedRangkaianBase } from './helpers/rangkaian-p5-pglite.js';

type JournalEntry = {
    idx: number;
    when: number;
    tag: string;
};

const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
) as { entries: JournalEntry[] };

const openDatabases: PGlite[] = [];
// PGlite cold-start plus the complete migration chain can exceed 30 seconds on
// Windows CI hosts when the full test suite is running concurrently.
const PGLITE_MIGRATION_TIMEOUT_MS = 120_000;

function migrationStatements(tag: string): string[] {
    return readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean);
}

async function createDatabase(): Promise<PGlite> {
    const database = new PGlite({ extensions: { pgcrypto, pg_trgm } });
    openDatabases.push(database);
    await database.waitReady;
    // Cloud SQL operations preinstall approved extensions with the grant
    // administrator; extension members remain outside ownership handoff.
    await database.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    // 0049 (index trigram Lacak) mensyaratkan pg_trgm dari langkah privileged.
    await database.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    // 0032 deliberately refuses to create roles: Production bootstraps these
    // with a separately approved CREATEROLE identity before the application
    // migrator runs. PGlite is an isolated database, so reproduce only the
    // fixed NOLOGIN policy roles and migrator membership needed by the chain.
    await enterTestMigratorRole(database);
    return database;
}

async function applyMigration(database: PGlite, entry: JournalEntry): Promise<void> {
    for (const statement of migrationStatements(entry.tag)) {
        await database.exec(statement);
    }
}

async function repairedTables(database: PGlite): Promise<string[]> {
    const result = await database.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'arsip_elektronik',
            'tunjuk_silang',
            'klasifikasi_jra_mapping'
          )
        ORDER BY table_name
    `);

    return result.rows.map(({ table_name }) => table_name);
}

function expectedSchemaColumns(): Array<{ tableName: string; columnName: string }> {
    const expected = new Map<string, Set<string>>();

    for (const value of Object.values(schema)) {
        if (!is(value, PgTable)) continue;

        const table = value as PgTable;
        const tableName = getTableName(table);
        const columns = expected.get(tableName) ?? new Set<string>();
        for (const column of Object.values(getTableColumns(table))) {
            columns.add(column.name);
        }
        expected.set(tableName, columns);
    }

    return [...expected.entries()]
        .flatMap(([tableName, columns]) =>
            [...columns].map((columnName) => ({ tableName, columnName })),
        )
        .sort((left, right) =>
            `${left.tableName}.${left.columnName}`.localeCompare(
                `${right.tableName}.${right.columnName}`,
            ),
        );
}

afterEach(async () => {
    await Promise.all(openDatabases.splice(0).map((database) => database.close()));
});

describe('PostgreSQL migration chain', () => {
    it('0049 gagal keras bila pg_trgm belum dipasang', async () => {
        const database = new PGlite({ extensions: { pgcrypto } });
        openDatabases.push(database);
        await database.waitReady;
        await database.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto');
        await enterTestMigratorRole(database);
        for (const entry of journal.entries) {
            if (entry.tag === '0049_lacak_trgm') {
                await expect(applyMigration(database, entry)).rejects.toThrow(/0049: extension pg_trgm belum dipasang/);
                return;
            }
            await applyMigration(database, entry);
        }
        throw new Error('0049_lacak_trgm tidak dijurnal');
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('0049 membuat enam index trigram Lacak bila pg_trgm terpasang', async () => {
        const database = await createDatabase();
        for (const entry of journal.entries) await applyMigration(database, entry);
        const { rows } = await database.query<{ indexname: string; indexdef: string }>(`
            SELECT indexname, indexdef FROM pg_indexes
             WHERE schemaname = 'public' AND indexname LIKE '%\\_trgm\\_idx' ORDER BY indexname`);
        expect(rows.map((row) => row.indexname)).toEqual([
            'surat_keluar_kepada_trgm_idx',
            'surat_keluar_nomor_norm_trgm_idx',
            'surat_keluar_perihal_trgm_idx',
            'surat_masuk_dari_trgm_idx',
            'surat_masuk_nomor_norm_trgm_idx',
            'surat_masuk_perihal_trgm_idx',
        ]);
        for (const row of rows) expect(row.indexdef).toMatch(/USING gin .*gin_trgm_ops/);
        // Review m7: pemiliknya harus administrator bootstrap (pemilik pgcrypto, di PGlite
        // superuser `postgres`), bukan sekadar "bukan migrator".
        const ekstensi = await database.query<{ extname: string; owner: string }>(
            "SELECT extname, pg_get_userbyid(extowner) AS owner FROM pg_extension WHERE extname IN ('pgcrypto','pg_trgm') ORDER BY extname");
        expect(ekstensi.rows).toEqual([{ extname: 'pg_trgm', owner: 'postgres' }, { extname: 'pgcrypto', owner: 'postgres' }]);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('has a contiguous, chronological journal with a SQL file for every entry', () => {
        expect(journal.entries.length).toBeGreaterThan(0);

        journal.entries.forEach((entry, index) => {
            expect(entry.idx).toBe(index);
            expect(existsSync(join(migrationsDir, `${entry.tag}.sql`))).toBe(true);
            if (index > 0) {
                expect(entry.when).toBeGreaterThan(journal.entries[index - 1].when);
            }
        });
    });

    it('applies every journaled migration to a fresh PostgreSQL database', async () => {
        const database = await createDatabase();

        for (const entry of journal.entries) {
            if (entry.tag === '0029_outgoing_security_classification') {
                // This row represents data created by a pre-0029 deployment.
                // The migration must not silently downgrade it to Biasa.
                await database.exec(`
                    INSERT INTO unit_kerja (id, name)
                    VALUES ('unit-legacy-outgoing-security', 'Legacy Outgoing Security');
                    INSERT INTO surat_keluar (unit_kerja_id, no_urut, tahun)
                    VALUES ('unit-legacy-outgoing-security', 1, 2026);
                `);
            }
            await applyMigration(database, entry);
        }

        const actualColumns = await database.query<{
            table_name: string;
            column_name: string;
        }>(`
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
        `);
        const actualColumnNames = new Set(
            actualColumns.rows.map(({ table_name, column_name }) =>
                `${table_name}.${column_name}`,
            ),
        );
        const missingSchemaColumns = expectedSchemaColumns()
            .map(({ tableName, columnName }) => `${tableName}.${columnName}`)
            .filter((name) => !actualColumnNames.has(name));
        expect(missingSchemaColumns).toEqual([]);

        await expect(repairedTables(database)).resolves.toEqual([
            'arsip_elektronik',
            'klasifikasi_jra_mapping',
            'tunjuk_silang',
        ]);

        const disposisi = await database.query<{ udt_name: string }>(`
            SELECT udt_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'surat_masuk'
              AND column_name = 'disposisi'
        `);
        expect(disposisi.rows).toEqual([{ udt_name: '_text' }]);

        const legacyOutgoing = await database.query<{ klasifikasi_keamanan: string | null }>(`
            SELECT klasifikasi_keamanan
            FROM surat_keluar
            WHERE unit_kerja_id = 'unit-legacy-outgoing-security'
        `);
        expect(legacyOutgoing.rows).toEqual([{ klasifikasi_keamanan: null }]);

        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES ('unit-numbering-unique', 'Unit Numbering');
            INSERT INTO surat_masuk (unit_kerja_id, no_urut, tahun)
            VALUES ('unit-numbering-unique', 1, 2026);
            INSERT INTO surat_keluar (unit_kerja_id, no_urut, tahun)
            VALUES ('unit-numbering-unique', 1, 2026);
        `);
        await expect(database.exec(`
            INSERT INTO surat_masuk (unit_kerja_id, no_urut, tahun)
            VALUES ('unit-numbering-unique', 1, 2026)
        `)).rejects.toThrow(/surat_masuk_unit_year_sequence_uidx|duplicate key/i);
        await expect(database.exec(`
            INSERT INTO surat_keluar (unit_kerja_id, no_urut, tahun)
            VALUES ('unit-numbering-unique', 1, 2026)
        `)).rejects.toThrow(/surat_keluar_unit_year_sequence_uidx|duplicate key/i);
        const newOutgoing = await database.query<{ klasifikasi_keamanan: string | null }>(`
            SELECT klasifikasi_keamanan
            FROM surat_keluar
            WHERE unit_kerja_id = 'unit-numbering-unique'
        `);
        expect(newOutgoing.rows).toEqual([{ klasifikasi_keamanan: 'biasa' }]);
        await expect(database.exec(`
            INSERT INTO surat_keluar (
                unit_kerja_id,
                no_urut,
                tahun,
                klasifikasi_keamanan
            ) VALUES (
                'unit-numbering-unique',
                2,
                2026,
                'internal-khusus'
            )
        `)).rejects.toThrow(/surat_keluar_klasifikasi_keamanan_check|check constraint/i);
        await expect(database.exec(`
            INSERT INTO surat_templates (unit_kerja_id, masuk_format, keluar_format)
            VALUES (
                'unit-numbering-unique',
                '{{noUrut}}/SM/{tahun}',
                '{noUrut}/{naskahDinas}/{tahun}'
            )
        `)).rejects.toThrow(/surat_templates_masuk_placeholder_check|check constraint/i);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('recovers when legacy 0004 was recorded without its snapshot tables', async () => {
        const database = await createDatabase();
        const migration0004Index = journal.entries.findIndex(
            ({ tag }) => tag === '0004_amazing_rawhide_kid',
        );
        const migration0005Index = journal.entries.findIndex(
            ({ tag }) => tag === '0005_first_fantastic_four',
        );

        expect(migration0004Index).toBeGreaterThan(0);
        expect(migration0005Index).toBe(migration0004Index + 1);

        for (const entry of journal.entries.slice(0, migration0004Index)) {
            await applyMigration(database, entry);
        }

        // This is the complete SQL shipped in the old/truncated 0004 file. A
        // real database in this state skips the repaired 0004 because Drizzle
        // already recorded its journal timestamp.
        await database.exec(`
            ALTER TABLE "surat_masuk"
            ALTER COLUMN "disposisi" SET DATA TYPE text[]
            USING CASE
              WHEN "disposisi" IS NULL THEN NULL
              ELSE ARRAY["disposisi"]
            END
        `);

        for (const entry of journal.entries.slice(migration0005Index)) {
            await applyMigration(database, entry);
        }

        await expect(repairedTables(database)).resolves.toEqual([
            'arsip_elektronik',
            'klasifikasi_jra_mapping',
            'tunjuk_silang',
        ]);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('reconciles legacy duplicate notification reads before adding uniqueness', async () => {
        const database = await createDatabase();
        const operationalIndex = journal.entries.findIndex(
            ({ tag }) => tag === '0022_operational_integrations',
        );
        expect(operationalIndex).toBeGreaterThan(0);
        for (const entry of journal.entries.slice(0, operationalIndex)) {
            await applyMigration(database, entry);
        }

        const userId = '10000000-0000-4000-8000-000000000099';
        await database.exec(`
            INSERT INTO users (id, email) VALUES ('${userId}', 'notification-dedupe@example.test');
            INSERT INTO notification_reads (user_id, notification_id, read_at) VALUES
                ('${userId}', 'workflow:item:pending:warning', '2026-01-01T00:00:00Z'),
                ('${userId}', 'workflow:item:pending:warning', '2026-01-02T00:00:00Z');
        `);

        await applyMigration(database, journal.entries[operationalIndex]);
        const count = await database.query<{ count: number }>(`
            SELECT count(*)::int AS count FROM notification_reads
            WHERE user_id = '${userId}' AND notification_id = 'workflow:item:pending:warning'
        `);
        expect(count.rows).toEqual([{ count: 1 }]);
        await expect(database.exec(`
            INSERT INTO notification_reads (user_id, notification_id)
            VALUES ('${userId}', 'workflow:item:pending:warning')
        `)).rejects.toThrow(/notification_reads_user_notification_unique|duplicate key/i);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('reconciles compatible legacy settings tables and rejects incompatible shapes', async () => {
        const operationalIndex = journal.entries.findIndex(
            ({ tag }) => tag === '0022_operational_integrations',
        );
        expect(operationalIndex).toBeGreaterThan(0);

        const compatible = await createDatabase();
        for (const entry of journal.entries.slice(0, operationalIndex)) {
            await applyMigration(compatible, entry);
        }
        await compatible.exec(`
            CREATE TABLE user_preferences (
                user_id uuid,
                theme varchar(20),
                language varchar(10),
                notifications_enabled boolean,
                email_notifications boolean,
                created_at timestamptz,
                updated_at timestamptz
            );
            CREATE TABLE surat_templates (
                unit_kerja_id varchar(50),
                masuk_format varchar(255),
                keluar_format varchar(255),
                created_at timestamptz,
                updated_at timestamptz
            );
        `);
        await applyMigration(compatible, journal.entries[operationalIndex]);
        // The legacy-reconciliation migration is deliberately idempotent for
        // manually repaired environments and disaster-recovery rehearsals.
        await applyMigration(compatible, journal.entries[operationalIndex]);
        const constraints = await compatible.query<{ conname: string }>(`
            SELECT conname
            FROM pg_constraint
            WHERE conrelid IN ('user_preferences'::regclass, 'surat_templates'::regclass)
            ORDER BY conname
        `);
        expect(constraints.rows.map(row => row.conname)).toEqual(expect.arrayContaining([
            'user_preferences_pkey',
            'user_preferences_theme_check',
            'surat_templates_pkey',
            'surat_templates_keluar_format_check',
            'surat_templates_masuk_placeholder_check',
        ]));

        const incompatible = await createDatabase();
        for (const entry of journal.entries.slice(0, operationalIndex)) {
            await applyMigration(incompatible, entry);
        }
        await incompatible.exec(`
            CREATE TABLE user_preferences (
                user_id uuid,
                theme text,
                language varchar(10),
                notifications_enabled boolean,
                email_notifications boolean,
                created_at timestamptz,
                updated_at timestamptz
            )
        `);
        await expect(applyMigration(incompatible, journal.entries[operationalIndex]))
            .rejects.toThrow(/user_preferences table is incompatible|expected varchar/i);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('fails loudly when legacy surat sequences contain duplicates', async () => {
        const database = await createDatabase();
        const operationalIndex = journal.entries.findIndex(
            ({ tag }) => tag === '0022_operational_integrations',
        );
        expect(operationalIndex).toBeGreaterThan(0);
        for (const entry of journal.entries.slice(0, operationalIndex)) {
            await applyMigration(database, entry);
        }
        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES ('unit-duplicate-sequence', 'Unit Duplicate');
            INSERT INTO surat_masuk (unit_kerja_id, no_urut, tahun) VALUES
                ('unit-duplicate-sequence', 9, 2026),
                ('unit-duplicate-sequence', 9, 2026);
        `);

        await expect(applyMigration(database, journal.entries[operationalIndex]))
            .rejects.toThrow(/surat_masuk numbering uniqueness.*sequence 9 occurs 2 times/i);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('persists durable bulk batches and requires complete private PDF metadata', async () => {
        const database = await createDatabase();
        for (const entry of journal.entries) {
            await applyMigration(database, entry);
        }

        const userId = '10000000-0000-4000-8000-000000000077';
        const batchId = '20000000-0000-4000-8000-000000000077';
        const itemId = '30000000-0000-4000-8000-000000000077';
        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES ('unit-bulk-durable', 'Unit Bulk Durable');
            INSERT INTO users (id, email, role, unit_kerja_id)
            VALUES ('${userId}', 'bulk-durable@example.test', 'staff', 'unit-bulk-durable');
            INSERT INTO bulk_upload_batches (
                id, unit_kerja_id, created_by, status, total_files, processed_files, expires_at
            ) VALUES (
                '${batchId}', 'unit-bulk-durable', '${userId}', 'pending', 1, 0, now() + interval '1 day'
            );
            INSERT INTO bulk_upload_items (
                id, batch_id, file_name, mime_type, size_bytes, sha256, blob_url
            ) VALUES (
                '${itemId}', '${batchId}', 'record.pdf', 'application/pdf', 12,
                repeat('a', 64),
                'https://example.private.blob.vercel-storage.com/bulk-upload/record.pdf'
            );
        `);

        await database.exec(`
            UPDATE bulk_upload_items SET blob_deleted_at = now() WHERE id = '${itemId}'
        `);
        const rows = await database.query<{
            batch_count: number;
            item_count: number;
            item_blob_deleted: boolean;
        }>(`
            SELECT
                (SELECT count(*)::int FROM bulk_upload_batches) AS batch_count,
                (SELECT count(*)::int FROM bulk_upload_items) AS item_count,
                (SELECT blob_deleted_at IS NOT NULL FROM bulk_upload_items WHERE id = '${itemId}')
                    AS item_blob_deleted
        `);
        expect(rows.rows).toEqual([{ batch_count: 1, item_count: 1, item_blob_deleted: true }]);

        await expect(database.exec(`
            INSERT INTO bulk_upload_batches (
                unit_kerja_id, created_by, status, total_files, processed_files, expires_at
            ) VALUES (
                'unit-bulk-durable', '${userId}', 'pending', 1, 0, now() + interval '1 day'
            )
        `)).rejects.toThrow(/bulk_upload_batches_one_active_owner_unit_idx|unique constraint/i);

        await database.exec(`
            UPDATE bulk_upload_batches SET status = 'expired' WHERE id = '${batchId}';
            INSERT INTO bulk_upload_batches (
                unit_kerja_id, created_by, status, total_files, processed_files, expires_at
            ) VALUES (
                'unit-bulk-durable', '${userId}', 'pending', 1, 0, now() + interval '1 day'
            );
        `);

        await expect(database.exec(`
            UPDATE bulk_upload_items SET status = 'confirmed' WHERE id = '${itemId}'
        `)).rejects.toThrow(/bulk_upload_items_confirmation_check|check constraint/i);

        await expect(database.exec(`
            INSERT INTO bulk_upload_items (
                batch_id, file_name, mime_type, size_bytes, sha256, blob_url
            ) VALUES (
                '${batchId}', 'gcs-missing-generation.pdf', 'application/pdf', 12,
                repeat('b', 64), 'gs://simsa-upload/bulk-upload/missing-generation.pdf'
            )
        `)).rejects.toThrow(/bulk_upload_items_object_generation_check|check constraint/i);

        await expect(database.exec(`
            INSERT INTO bulk_upload_items (
                batch_id, file_name, mime_type, size_bytes, sha256, blob_url, object_generation
            ) VALUES (
                '${batchId}', 'vercel-with-generation.pdf', 'application/pdf', 12,
                repeat('c', 64),
                'https://example.private.blob.vercel-storage.com/bulk-upload/with-generation.pdf',
                '1735689600123456'
            )
        `)).rejects.toThrow(/bulk_upload_items_object_generation_check|check constraint/i);

        await database.exec(`
            INSERT INTO bulk_upload_items (
                batch_id, file_name, mime_type, size_bytes, sha256, blob_url, object_generation
            ) VALUES (
                '${batchId}', 'gcs-pinned.pdf', 'application/pdf', 12,
                repeat('d', 64), 'gs://simsa-upload/bulk-upload/pinned.pdf',
                '1735689600123456'
            );
            INSERT INTO file_attachments (
                entity_type, entity_id, file_url, object_generation
            ) VALUES (
                'surat_masuk', '40000000-0000-4000-8000-000000000077',
                'gs://simsa-upload/surat-masuk/pinned.pdf', '1735689600123456'
            );
        `);

        await expect(database.exec(`
            INSERT INTO file_attachments (entity_type, entity_id, file_url)
            VALUES (
                'surat_masuk', '50000000-0000-4000-8000-000000000077',
                'gs://simsa-upload/surat-masuk/missing-generation.pdf'
            )
        `)).rejects.toThrow(/file_attachments_object_generation_check|check constraint/i);

        await expect(database.exec(`
            INSERT INTO autentikasi (
                nomor_berita_acara, tanggal_autentikasi, kegiatan, jumlah_arsip, file_lampiran
            ) VALUES ('BA-INVALID', '2026-08-28', 'Uji locator', 1, 'private-locator-only')
        `)).rejects.toThrow(/autentikasi_file_lampiran_metadata_check|check constraint/i);

        await expect(database.exec(`
            INSERT INTO autentikasi (
                nomor_berita_acara, tanggal_autentikasi, kegiatan, jumlah_arsip,
                file_lampiran, file_lampiran_sha256, file_lampiran_size_bytes
            ) VALUES (
                'BA-GCS-MISSING-GENERATION', '2026-08-28', 'Uji generasi GCS', 1,
                'gs://simsa-final/autentikasi/missing-generation.pdf', repeat('e', 64), 12
            )
        `)).rejects.toThrow(/autentikasi_file_lampiran_generation_check|check constraint/i);

        await expect(database.exec(`
            INSERT INTO autentikasi (
                nomor_berita_acara, tanggal_autentikasi, kegiatan, jumlah_arsip,
                file_lampiran, file_lampiran_object_generation,
                file_lampiran_sha256, file_lampiran_size_bytes
            ) VALUES (
                'BA-HTTPS-WITH-GENERATION', '2026-08-28', 'Uji generasi HTTPS', 1,
                'https://example.private.blob.vercel-storage.com/autentikasi/with-generation.pdf',
                '1735689600123456', repeat('f', 64), 12
            )
        `)).rejects.toThrow(/autentikasi_file_lampiran_generation_check|check constraint/i);

        await database.exec(`
            INSERT INTO autentikasi (
                nomor_berita_acara, tanggal_autentikasi, kegiatan, jumlah_arsip,
                file_lampiran, file_lampiran_object_generation,
                file_lampiran_sha256, file_lampiran_size_bytes
            ) VALUES (
                'BA-GCS-PINNED', '2026-08-28', 'Uji generasi GCS', 1,
                'gs://simsa-final/autentikasi/pinned.pdf', '1735689600123456',
                repeat('a', 64), 12
            )
        `);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('fails loudly when legacy autentikasi PDFs have not been reconciled to private Blob', async () => {
        const database = await createDatabase();
        const durableIndex = journal.entries.findIndex(
            ({ tag }) => tag === '0024_durable_bulk_and_autentikasi_blob',
        );
        expect(durableIndex).toBeGreaterThan(0);
        for (const entry of journal.entries.slice(0, durableIndex)) {
            await applyMigration(database, entry);
        }
        await database.exec(`
            INSERT INTO autentikasi (
                nomor_berita_acara, tanggal_autentikasi, kegiatan,
                jumlah_arsip, file_lampiran
            ) VALUES (
                'BA-LEGACY/2025', '2025-01-01', 'Legacy process-local PDF',
                1, '/uploads/autentikasi/legacy.pdf'
            )
        `);

        await expect(applyMigration(database, journal.entries[durableIndex]))
            .rejects.toThrow(/legacy autentikasi\.file_lampiran.*explicit reconciliation.*private Blob/i);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('blocks 0021 before schema changes for an active privileged user without an identity', async () => {
        const database = await createDatabase();
        const integrityIndex = journal.entries.findIndex(
            ({ tag }) => tag === '0021_archive_source_domain_integrity',
        );
        expect(integrityIndex).toBeGreaterThan(0);

        // Production is currently journaled through 0020. Reproduce that exact
        // resume point, including the old 0009 which has already removed
        // users.password, before exercising the new forward preflight.
        for (const entry of journal.entries.slice(0, integrityIndex)) {
            await applyMigration(database, entry);
        }

        const superAdminId = '10000000-0000-4000-8000-000000000021';
        const dirjenAdminId = '11000000-0000-4000-8000-000000000021';
        const sesditjenAdminId = '12000000-0000-4000-8000-000000000021';
        const importedStaffId = '20000000-0000-4000-8000-000000000021';
        const importedUserId = '21000000-0000-4000-8000-000000000021';
        await database.exec(`
            INSERT INTO users (id, email, role, is_active)
            VALUES
                ('${superAdminId}', 'orphaned-super-admin@example.test', 'super_admin', true),
                ('${dirjenAdminId}', 'orphaned-dirjen-admin@example.test', 'admin_dirjen', true),
                ('${sesditjenAdminId}', 'orphaned-sesditjen-admin@example.test', 'admin_sesditjen', true)
        `);

        await expect(applyMigration(database, journal.entries[integrityIndex]))
            .rejects.toThrow(/0021 preflight failed.*active privileged user.*no account identity/i);

        const schemaAfterRejection = await database.query<{ index_name: string | null }>(`
            SELECT to_regclass('public.arsip_source_surat_kind_unique')::text AS index_name
        `);
        expect(schemaAfterRejection.rows).toEqual([{ index_name: null }]);

        // Owner reconciliation is an explicit operator action. Deactivation
        // is safe here; the migration must never invent a credential. An
        // account-less imported staff record remains a supported state.
        await database.exec(`
            UPDATE users
            SET is_active = false
            WHERE id IN ('${superAdminId}', '${dirjenAdminId}', '${sesditjenAdminId}');
            INSERT INTO users (id, email, role, is_active)
            VALUES
                ('${importedStaffId}', 'imported-staff@example.test', 'staff', true),
                ('${importedUserId}', 'imported-user@example.test', 'user', true)
        `);

        await applyMigration(database, journal.entries[integrityIndex]);

        const postconditions = await database.query<{
            index_name: string | null;
            imported_account_count: number;
        }>(`
            SELECT
                to_regclass('public.arsip_source_surat_kind_unique')::text AS index_name,
                (
                    SELECT count(*)::int
                    FROM accounts
                    WHERE user_id IN ('${importedStaffId}', '${importedUserId}')
                ) AS imported_account_count
        `);
        expect(postconditions.rows).toEqual([{
            index_name: 'arsip_source_surat_kind_unique',
            imported_account_count: 0,
        }]);
    }, 60_000);

    it('reconciles stale surat archive flags when source links do not exist', async () => {
        const database = await createDatabase();
        const integrityIndex = journal.entries.findIndex(
            ({ tag }) => tag === '0021_archive_source_domain_integrity',
        );
        expect(integrityIndex).toBeGreaterThan(0);
        for (const entry of journal.entries.slice(0, integrityIndex)) {
            await applyMigration(database, entry);
        }

        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES ('unit-stale-flag', 'Unit Stale Flag');
            INSERT INTO surat_masuk (
                id, unit_kerja_id, no_urut, tahun, nomor_surat, is_archived
            ) VALUES (
                '10000000-0000-4000-8000-000000000088',
                'unit-stale-flag', 1, 2026, 'SM-STALE/2026', true
            );
        `);

        await applyMigration(database, journal.entries[integrityIndex]);
        const flag = await database.query<{ is_archived: boolean }>(`
            SELECT is_archived FROM surat_masuk
            WHERE id = '10000000-0000-4000-8000-000000000088'
        `);
        expect(flag.rows).toEqual([{ is_archived: false }]);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('enforces one archive per polymorphic surat source and keeps source metadata authoritative', async () => {
        const database = await createDatabase();
        for (const entry of journal.entries) {
            await applyMigration(database, entry);
        }

        const sharedSourceId = '10000000-0000-4000-8000-000000000001';
        const incomingOnlyId = '10000000-0000-4000-8000-000000000002';
        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES ('unit-integrity', 'Unit Integrity');

            INSERT INTO surat_masuk (
                id, unit_kerja_id, no_urut, tahun, nomor_surat,
                tanggal_surat, perihal, klasifikasi_kode
            ) VALUES
                ('${sharedSourceId}', 'unit-integrity', 1, 2026, 'SM-1/2026',
                 '2026-01-02', 'Surat masuk bersama', 'PT.01.01'),
                ('${incomingOnlyId}', 'unit-integrity', 2, 2026, 'SM-2/2026',
                 '2026-01-03', 'Surat masuk tunggal', 'PT.01.01');

            -- UUIDs may legitimately collide between the two source tables.
            INSERT INTO surat_keluar (
                id, unit_kerja_id, no_urut, tahun, nomor_surat,
                tanggal_surat, perihal, klasifikasi_substantif_kode
            ) VALUES (
                '${sharedSourceId}', 'unit-integrity', 1, 2026, 'SK-1/2026',
                '2026-02-02', 'Surat keluar bersama', 'PT.01.01'
            );

            INSERT INTO arsip (
                unit_kerja_id, jenis_arsip, source_surat_id, tahun,
                kode_klasifikasi, nomor_surat_original,
                tanggal_surat_original, perihal_original
            ) VALUES (
                'unit-integrity', 'masuk', '${sharedSourceId}', 2026,
                'PT.01.01', 'SM-1/2026', '2026-01-02', 'Surat masuk bersama'
            );

            INSERT INTO arsip (
                unit_kerja_id, jenis_arsip, source_surat_id, tahun,
                kode_klasifikasi, nomor_surat_original,
                tanggal_surat_original, perihal_original
            ) VALUES (
                'unit-integrity', 'keluar', '${sharedSourceId}', 2026,
                'PT.01.01', 'SK-1/2026', '2026-02-02', 'Surat keluar bersama'
            );
        `);

        const flags = await database.query<{ source: string; is_archived: boolean }>(`
            SELECT 'masuk' AS source, is_archived FROM surat_masuk WHERE id = '${sharedSourceId}'
            UNION ALL
            SELECT 'keluar', is_archived FROM surat_keluar WHERE id = '${sharedSourceId}'
            ORDER BY source
        `);
        expect(flags.rows).toEqual([
            { source: 'keluar', is_archived: true },
            { source: 'masuk', is_archived: true },
        ]);

        await expect(database.exec(`
            INSERT INTO arsip (
                unit_kerja_id, jenis_arsip, source_surat_id, tahun,
                kode_klasifikasi, nomor_surat_original,
                tanggal_surat_original, perihal_original
            ) VALUES (
                'unit-integrity', 'masuk', '${sharedSourceId}', 2026,
                'PT.01.01', 'SM-1/2026', '2026-01-02', 'Surat masuk bersama'
            )
        `)).rejects.toThrow(/arsip_source_surat_kind_unique|duplicate key/i);

        await expect(database.exec(`
            INSERT INTO arsip (
                unit_kerja_id, jenis_arsip, source_surat_id, tahun,
                nomor_surat_original, tanggal_surat_original, perihal_original
            ) VALUES (
                'unit-integrity', 'keluar', '${incomingOnlyId}', 2026,
                'SM-2/2026', '2026-01-03', 'Surat masuk tunggal'
            )
        `)).rejects.toThrow(/source keluar.*does not exist/i);

        await expect(database.exec(`
            INSERT INTO arsip (
                unit_kerja_id, jenis_arsip, source_surat_id, tahun,
                kode_klasifikasi, nomor_surat_original,
                tanggal_surat_original, perihal_original
            ) VALUES (
                'unit-integrity', 'masuk', '${incomingOnlyId}', 2025,
                'PT.01.01', 'SM-2/2026', '2026-01-03', 'Surat masuk tunggal'
            )
        `)).rejects.toThrow(/source metadata does not match/i);

        await expect(database.exec(`
            UPDATE surat_masuk
            SET nomor_surat = 'SM-DIVERGEN/2026'
            WHERE id = '${sharedSourceId}'
        `)).rejects.toThrow(/metadata cannot diverge/i);

        await expect(database.exec(`
            DELETE FROM surat_keluar WHERE id = '${sharedSourceId}'
        `)).rejects.toThrow(/cannot delete.*while archive/i);

        await expect(database.exec(`
            UPDATE arsip
            SET source_surat_id = NULL
            WHERE jenis_arsip = 'masuk' AND source_surat_id = '${sharedSourceId}'
        `)).rejects.toThrow(/source linkage is immutable/i);

        await expect(database.exec(`
            DELETE FROM arsip
            WHERE jenis_arsip = 'keluar' AND source_surat_id = '${sharedSourceId}'
        `)).rejects.toThrow(/source-linked archive cannot be deleted/i);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('backfills legacy user units and enforces canonical role mandates', async () => {
        const database = await createDatabase();
        const mandateIndex = journal.entries.findIndex(
            ({ tag }) => tag === '0027_canonical_user_unit_mandates',
        );
        expect(mandateIndex).toBeGreaterThan(0);

        for (const entry of journal.entries.slice(0, mandateIndex)) {
            await applyMigration(database, entry);
        }

        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES
                ('ditjen', 'Direktorat Jenderal'),
                ('sesditjen', 'Sekretariat Direktorat Jenderal'),
                ('legacy-unit', 'Unit Legacy');

            INSERT INTO users (id, email, role, unit_kerja_id) VALUES
                ('10000000-0000-4000-8000-000000000071', 'legacy-super@example.test',
                 'super_admin', 'legacy-unit'),
                ('10000000-0000-4000-8000-000000000072', 'legacy-dirjen@example.test',
                 'admin_dirjen', 'legacy-unit'),
                ('10000000-0000-4000-8000-000000000073', 'legacy-sesditjen@example.test',
                 'admin_sesditjen', NULL);
        `);

        await applyMigration(database, journal.entries[mandateIndex]);

        const assignments = await database.query<{
            role: string;
            unit_kerja_id: string | null;
        }>(`
            SELECT role, unit_kerja_id
            FROM users
            WHERE email LIKE 'legacy-%@example.test'
            ORDER BY role
        `);
        expect(assignments.rows).toEqual([
            { role: 'admin_dirjen', unit_kerja_id: 'ditjen' },
            { role: 'admin_sesditjen', unit_kerja_id: 'sesditjen' },
            { role: 'super_admin', unit_kerja_id: null },
        ]);

        await expect(database.exec(`
            UPDATE users SET unit_kerja_id = 'legacy-unit'
            WHERE role = 'super_admin'
        `)).rejects.toThrow(/users_role_unit_mandate_check|check constraint/i);
        await expect(database.exec(`
            UPDATE users SET unit_kerja_id = 'legacy-unit'
            WHERE role = 'admin_dirjen'
        `)).rejects.toThrow(/users_role_unit_mandate_check|check constraint/i);
        await expect(database.exec(`
            UPDATE users SET unit_kerja_id = NULL
            WHERE role = 'admin_sesditjen'
        `)).rejects.toThrow(/users_role_unit_mandate_check|check constraint/i);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('0046 menolak distribusi yang belum direkonsiliasi lalu meng-upgrade data lama tanpa memicu guard 0021', async () => {
        const database = await createDatabase();
        const index0046 = journal.entries.findIndex(({ tag }) => tag === '0046_rangkaian_surat');
        expect(index0046).toBeGreaterThan(0);
        for (const entry of journal.entries.slice(0, index0046)) {
            await applyMigration(database, entry);
        }

        const smLama = '46000000-0000-4000-8000-000000000001';
        const skBalasan = '46000000-0000-4000-8000-000000000002';
        const skArsip = '46000000-0000-4000-8000-000000000003';
        // Fixture meniru data lama: perihal NULL, balasan_untuk terisi, satu
        // surat keluar terarsip sehingga trigger 0021 aktif saat 0046 meng-UPDATE.
        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES
                ('ditjen', 'Direktorat Jenderal'),
                ('sesditjen', 'Sekretariat Direktorat Jenderal'),
                ('unit-46-target', 'Unit Target 0046');
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal)
            VALUES ('${smLama}', 'sesditjen', 1, 2025, 'B-12/PTPP.1/IX/2024', NULL);
            INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, balasan_untuk)
            VALUES
                ('${skBalasan}', 'sesditjen', 1, 2025, 'ND-1/2025', 'Balasan lama', '${smLama}'),
                ('${skArsip}', 'sesditjen', 2, 2025, 'ND-2/2025', 'Balasan terarsip', '${smLama}');
            INSERT INTO arsip (
                unit_kerja_id, jenis_arsip, source_surat_id, tahun,
                nomor_surat_original, perihal_original
            ) VALUES ('sesditjen', 'keluar', '${skArsip}', 2025, 'ND-2/2025', 'Balasan terarsip');
            INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status)
            VALUES ('${smLama}', 'sesditjen', 'unit-46-target', 'diarsipkan');
        `);

        await expect(applyMigration(database, journal.entries[index0046]))
            .rejects.toThrow(/0046: status surat_distributions tidak dikenal/);

        await database.exec(`
            UPDATE surat_distributions SET status = 'sent' WHERE surat_masuk_id = '${smLama}';
            INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status)
            VALUES ('${smLama}', 'sesditjen', 'unit-46-target', 'received');
        `);
        await expect(applyMigration(database, journal.entries[index0046]))
            .rejects.toThrow(/0046: distribusi aktif ganda/);
        const untouched = await database.query<{ relation: string | null }>(
            `SELECT to_regclass('public.rangkaian_surat')::text AS relation`,
        );
        expect(untouched.rows).toEqual([{ relation: null }]);

        await database.exec(`
            UPDATE surat_distributions
            SET status = 'rejected', rejection_reason = 'Salah alamat unit tujuan'
            WHERE surat_masuk_id = '${smLama}' AND status = 'received';
        `);
        await applyMigration(database, journal.entries[index0046]);

        const upgraded = await database.query<{
            id: string;
            asal_naskah: string | null;
            is_archived: boolean;
        }>(`SELECT id, asal_naskah, is_archived FROM surat_keluar ORDER BY id`);
        expect(upgraded.rows).toEqual([
            { id: skBalasan, asal_naskah: 'tindak_lanjut', is_archived: false },
            { id: skArsip, asal_naskah: 'tindak_lanjut', is_archived: true },
        ]);

        const pengawas = await database.query<{ id: string; is_unit_pengawas: boolean }>(`
            SELECT id, is_unit_pengawas FROM unit_kerja ORDER BY id COLLATE "C"
        `);
        expect(pengawas.rows).toEqual([
            { id: 'ditjen', is_unit_pengawas: true },
            { id: 'sesditjen', is_unit_pengawas: true },
            { id: 'unit-46-target', is_unit_pengawas: false },
        ]);

        const distribusi = await database.query(`
            SELECT status, rangkaian_id, penanggung_jawab, ditutup_pengawas
            FROM surat_distributions ORDER BY status
        `);
        expect(distribusi.rows).toEqual([
            { status: 'rejected', rangkaian_id: null, penanggung_jawab: false, ditutup_pengawas: false },
            { status: 'sent', rangkaian_id: null, penanggung_jawab: false, ditutup_pengawas: false },
        ]);

        // Baris rejected boleh berulang; distribusi aktif ganda ditolak index parsial.
        await database.exec(`
            INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status)
            VALUES ('${smLama}', 'sesditjen', 'unit-46-target', 'rejected')
        `);
        await expect(database.exec(`
            INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status)
            VALUES ('${smLama}', 'sesditjen', 'unit-46-target', 'sent')
        `)).rejects.toThrow(/surat_distributions_active_target_uidx|duplicate key/i);
        await expect(database.exec(`
            UPDATE surat_distributions SET status = 'arsip' WHERE status = 'sent'
        `)).rejects.toThrow(/surat_distributions_status_check|check constraint/i);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('0046 menegakkan jejak alasan, index anggota, hak append-only, dan flag pengawas pada instalasi baru', async () => {
        const database = await createDatabase();
        for (const entry of journal.entries) {
            await applyMigration(database, entry);
        }

        const userId = '46000000-0000-4000-8000-0000000000a1';
        const sm = '46000000-0000-4000-8000-0000000000a2';
        const sk = '46000000-0000-4000-8000-0000000000a3';
        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES
                ('ditjen', 'Ditjen'), ('sesditjen', 'Sesditjen'), ('unit-46-a', 'Unit A');
            INSERT INTO users (id, email, role)
            VALUES ('${userId}', 'rangkaian-0046@example.test', 'super_admin');
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal)
            VALUES ('${sm}', 'sesditjen', 1, 2026, 'SM-1/2026', 'Surat induk');
            INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal)
            VALUES ('${sk}', 'unit-46-a', 1, 2026, 'ND-1/2026', 'Tindak lanjut');
        `);

        // Seed deployment berjalan SESUDAH migrasi; trigger insert memberi nilai awal.
        const pengawas = await database.query<{ id: string; is_unit_pengawas: boolean }>(`
            SELECT id, is_unit_pengawas FROM unit_kerja
            WHERE id IN ('ditjen', 'sesditjen', 'unit-46-a') ORDER BY id COLLATE "C"
        `);
        expect(pengawas.rows).toEqual([
            { id: 'ditjen', is_unit_pengawas: true },
            { id: 'sesditjen', is_unit_pengawas: true },
            { id: 'unit-46-a', is_unit_pengawas: false },
        ]);

        const rangkaianId = (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_surat (kode, asal, unit_pencatat_id, judul, tahun)
            VALUES ('RS-2026-000001', 'surat_masuk', 'sesditjen', 'Surat induk', 2026)
            RETURNING id
        `)).rows[0].id;

        await expect(database.exec(`
            UPDATE rangkaian_surat
            SET status = 'selesai', selesai_manual = true, selesai_by = '${userId}'
            WHERE id = '${rangkaianId}'
        `)).rejects.toThrow(/rangkaian_selesai_manual_check/);
        await expect(database.exec(`
            UPDATE rangkaian_surat
            SET status = 'selesai', selesai_manual = true, selesai_by = '${userId}',
                catatan_selesai = '   pendek  '
            WHERE id = '${rangkaianId}'
        `)).rejects.toThrow(/rangkaian_selesai_manual_check/);
        await expect(database.exec(`
            UPDATE rangkaian_surat SET status = 'digabung' WHERE id = '${rangkaianId}'
        `)).rejects.toThrow(/rangkaian_gabung_check/);

        const indukId = (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran)
            VALUES ('${rangkaianId}', '${sm}', 'sesditjen', 'induk') RETURNING id
        `)).rows[0].id;
        const anggotaId = (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id)
            VALUES ('${rangkaianId}', '${sk}', 'unit-46-a') RETURNING id
        `)).rows[0].id;
        await expect(database.exec(`
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, surat_keluar_id, unit_kerja_id)
            VALUES ('${rangkaianId}', '${sm}', '${sk}', 'sesditjen')
        `)).rejects.toThrow(/rangkaian_anggota_satu_surat_check/);
        await expect(database.exec(`
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id)
            VALUES ('${rangkaianId}', '${sm}', 'sesditjen')
        `)).rejects.toThrow(/rangkaian_anggota_sm_uidx|duplicate key/i);

        const relasiId = (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi)
            VALUES ('${rangkaianId}', '${anggotaId}', '${indukId}', 'tindak_lanjut') RETURNING id
        `)).rows[0].id;
        await expect(database.exec(`
            UPDATE rangkaian_relasi SET cancelled_at = now(), cancelled_by = '${userId}'
            WHERE id = '${relasiId}'
        `)).rejects.toThrow(/rangkaian_relasi_pembatalan_check/);
        await expect(database.exec(`
            INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi)
            VALUES ('${rangkaianId}', '${anggotaId}', '${indukId}', 'tindak_lanjut')
        `)).rejects.toThrow(/rangkaian_relasi_active_uidx|duplicate key/i);

        await expect(database.exec(`
            INSERT INTO rangkaian_peserta (
                rangkaian_id, unit_kerja_id, peran, berakhir_at, berakhir_by
            ) VALUES ('${rangkaianId}', 'unit-46-a', 'disposisi_lama', now(), '${userId}')
        `)).rejects.toThrow(/rangkaian_peserta_berakhir_check/);
        await expect(database.exec(`
            INSERT INTO rangkaian_koreksi_berkas (
                rangkaian_id, unit_pengolah_lama, unit_pengolah_baru,
                klasifikasi_lama, klasifikasi_baru, alasan, diajukan_by
            ) VALUES ('${rangkaianId}', 'unit-46-a', 'sesditjen', 1, 1, '   ', '${userId}')
        `)).rejects.toThrow(/rangkaian_koreksi_alasan_check/);

        const privileges = await database.query<Record<string, boolean>>(`
            SELECT
                has_table_privilege('simsa_api_runtime', 'public.rangkaian_surat', 'DELETE') AS delete_surat,
                has_table_privilege('simsa_api_runtime', 'public.rangkaian_anggota', 'DELETE') AS delete_anggota,
                has_table_privilege('simsa_api_runtime', 'public.rangkaian_relasi', 'DELETE') AS delete_relasi,
                has_table_privilege('simsa_api_runtime', 'public.rangkaian_peserta', 'DELETE') AS delete_peserta,
                has_table_privilege('simsa_api_runtime', 'public.rangkaian_koreksi_berkas', 'DELETE') AS delete_koreksi,
                has_table_privilege('simsa_api_runtime', 'public.rangkaian_surat', 'INSERT,UPDATE') AS write_surat,
                has_sequence_privilege('simsa_api_runtime', 'public.rangkaian_surat_kode_seq', 'USAGE') AS kode_seq
        `);
        expect(privileges.rows).toEqual([{
            delete_surat: false,
            delete_anggota: false,
            delete_relasi: false,
            delete_peserta: false,
            delete_koreksi: false,
            write_surat: true,
            kode_seq: true,
        }]);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('0046 mengunci rangkaian yang diberkaskan, mencegah siklus gabung, dan hanya menerima koreksi berkas yang disetujui', async () => {
        const database = await createDatabase();
        // Semantik 0046 (termasuk jalur legacy rangkaian_id NULL dan lebih dari satu koreksi terbuka) diuji sebelum pengerasan 0048.
        const sebelum0048 = journal.entries.findIndex((entry) => entry.tag === '0048_rangkaian_pengerasan');
        for (const entry of sebelum0048 < 0 ? journal.entries : journal.entries.slice(0, sebelum0048)) {
            await applyMigration(database, entry);
        }

        const maker = '46000000-0000-4000-8000-0000000000b1';
        const checker = '46000000-0000-4000-8000-0000000000b2';
        const sm = '46000000-0000-4000-8000-0000000000b3';
        const smLain = '46000000-0000-4000-8000-0000000000b4';
        const sk = '46000000-0000-4000-8000-0000000000b5';
        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES
                ('unit-46-tu', 'TU'), ('unit-46-dir', 'Direktorat'), ('unit-46-dir2', 'Direktorat 2');
            INSERT INTO users (id, email, role) VALUES
                ('${maker}', 'maker-0046@example.test', 'super_admin'),
                ('${checker}', 'checker-0046@example.test', 'super_admin');
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal) VALUES
                ('${sm}', 'unit-46-tu', 1, 2026, 'SM-46/2026', 'Surat induk'),
                ('${smLain}', 'unit-46-tu', 2, 2026, 'SM-47/2026', 'Surat lain');
            INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, approval_status)
            VALUES ('${sk}', 'unit-46-dir', 1, 2026, 'ND-46/2026', 'Tindak lanjut terarsip', 'approved');
            INSERT INTO arsip (
                unit_kerja_id, jenis_arsip, source_surat_id, tahun,
                nomor_surat_original, perihal_original
            ) VALUES ('unit-46-dir', 'keluar', '${sk}', 2026, 'ND-46/2026', 'Tindak lanjut terarsip');
        `);
        const klasifikasi = async (kode: string, key: string) => (await database.query<{ id: number }>(`
            INSERT INTO klasifikasi_arsip (kode, source_record_key, jenis, tipe)
            VALUES ('${kode}', '${key}', 'Uji rangkaian', 'substantif') RETURNING id
        `)).rows[0].id;
        const klasLama = await klasifikasi('PT.01.01', 'test:0046:0001');
        const klasBaru = await klasifikasi('PT.01.02', 'test:0046:0002');
        const rangkaian = async (kode: string) => (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_surat (kode, asal, unit_pencatat_id, judul, tahun)
            VALUES ('${kode}', 'surat_masuk', 'unit-46-tu', 'Uji ${kode}', 2026) RETURNING id
        `)).rows[0].id;
        const berkasA = await rangkaian('RS-2026-900001');
        const b = await rangkaian('RS-2026-900002');
        const c = await rangkaian('RS-2026-900003');

        const induk = (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran)
            VALUES ('${berkasA}', '${sm}', 'unit-46-tu', 'induk') RETURNING id
        `)).rows[0].id;
        // Surat keluar terarsip dapat menjadi anggota: tidak ada UPDATE atas
        // baris surat_keluar sehingga guard 0021 tidak terpicu.
        const tindakLanjut = (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id)
            VALUES ('${berkasA}', '${sk}', 'unit-46-dir') RETURNING id
        `)).rows[0].id;
        await database.exec(`
            INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi)
            VALUES ('${berkasA}', '${tindakLanjut}', '${induk}', 'tindak_lanjut');
            INSERT INTO surat_distributions (
                surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id
            ) VALUES ('${sm}', 'unit-46-tu', 'unit-46-dir', 'processed', '${berkasA}');
            UPDATE rangkaian_surat
            SET status = 'diberkaskan', unit_pengolah_id = 'unit-46-dir',
                klasifikasi_item_id = ${klasLama}, diberkaskan_at = now(), diberkaskan_by = '${maker}'
            WHERE id = '${berkasA}';
        `);

        await expect(database.exec(`
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id)
            VALUES ('${berkasA}', '${smLain}', 'unit-46-tu')
        `)).rejects.toThrow(/sudah diberkaskan/);
        await expect(database.exec(`
            UPDATE rangkaian_relasi SET keterangan = 'ubah setelah ditutup' WHERE rangkaian_id = '${berkasA}'
        `)).rejects.toThrow(/sudah diberkaskan/);
        // Jalur distribusi lama tanpa rangkaian_id tetap tertahan lewat keanggotaan surat.
        await expect(database.exec(`
            INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status)
            VALUES ('${sm}', 'unit-46-tu', 'unit-46-dir2', 'sent')
        `)).rejects.toThrow(/sudah diberkaskan/);
        await expect(database.exec(`
            UPDATE surat_distributions SET status = 'received' WHERE rangkaian_id = '${berkasA}'
        `)).rejects.toThrow(/sudah diberkaskan/);
        await expect(database.exec(`
            DELETE FROM surat_distributions WHERE rangkaian_id = '${berkasA}'
        `)).rejects.toThrow(/sudah diberkaskan/);
        await expect(database.exec(`
            UPDATE rangkaian_surat SET status = 'selesai' WHERE id = '${berkasA}'
        `)).rejects.toThrow(/tidak dapat dibuka kembali/);
        await expect(database.exec(`
            UPDATE rangkaian_surat SET unit_pengolah_id = 'unit-46-tu' WHERE id = '${berkasA}'
        `)).rejects.toThrow(/Koreksi Berkas/);
        await expect(database.exec(`
            UPDATE rangkaian_anggota SET unit_kerja_id = 'unit-46-dir2' WHERE id = '${induk}'
        `)).rejects.toThrow(/Identitas anggota rangkaian/);
        // Kolom non-identitas anggota tetap terkunci selama berkas tertutup.
        await expect(database.exec(`
            UPDATE rangkaian_anggota SET sumber = 'tautan' WHERE id = '${induk}'
        `)).rejects.toThrow(/sudah diberkaskan/);
        await expect(database.exec(`
            DELETE FROM rangkaian_anggota WHERE id = '${tindakLanjut}'
        `)).rejects.toThrow(/sudah diberkaskan/);
        await expect(database.exec(`
            INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi)
            VALUES ('${berkasA}', '${induk}', '${tindakLanjut}', 'merujuk')
        `)).rejects.toThrow(/sudah diberkaskan/);
        await expect(database.exec(`
            DELETE FROM rangkaian_relasi WHERE rangkaian_id = '${berkasA}'
        `)).rejects.toThrow(/sudah diberkaskan/);

        // Memindahkan disposisi keluar dari berkas tertutup tetap ditolak.
        const distribusiTertutup = (await database.query<{ id: string }>(`
            SELECT id FROM surat_distributions WHERE rangkaian_id = '${berkasA}'
        `)).rows[0].id;
        await expect(database.exec(`
            UPDATE surat_distributions SET rangkaian_id = '${b}' WHERE id = '${distribusiTertutup}'
        `)).rejects.toThrow(/sudah diberkaskan/);
        // Kontrol positif: disposisi lama (rangkaian_id NULL) untuk surat yang
        // bukan anggota berkas manapun tetap dapat dibuat.
        const distribusiLegacy = (await database.query<{ id: string }>(`
            INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status)
            VALUES ('${smLain}', 'unit-46-tu', 'unit-46-dir2', 'sent') RETURNING id
        `)).rows[0].id;
        // ...tetapi memindahkannya ke surat yang anggota berkas tertutup tetap ditolak.
        await expect(database.exec(`
            UPDATE surat_distributions SET surat_masuk_id = '${sm}' WHERE id = '${distribusiLegacy}'
        `)).rejects.toThrow(/sudah diberkaskan/);

        // Bukti pemberkasan dan kolom header lain tetap terkunci; hanya
        // unit_pengolah_id/klasifikasi_item_id (lewat Koreksi Berkas) dan
        // updated_at yang dikecualikan.
        await expect(database.exec(`
            UPDATE rangkaian_surat SET diberkaskan_at = now() WHERE id = '${berkasA}'
        `)).rejects.toThrow(/tidak dapat diubah/);
        await expect(database.exec(`
            UPDATE rangkaian_surat SET judul = 'Judul diubah setelah ditutup' WHERE id = '${berkasA}'
        `)).rejects.toThrow(/sudah diberkaskan/);
        await expect(database.exec(`
            UPDATE rangkaian_surat SET selesai_at = now() WHERE id = '${berkasA}'
        `)).rejects.toThrow(/sudah diberkaskan/);

        const koreksi = (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_koreksi_berkas (
                rangkaian_id, unit_pengolah_lama, unit_pengolah_baru,
                klasifikasi_lama, klasifikasi_baru, alasan, diajukan_by
            ) VALUES (
                '${berkasA}', 'unit-46-dir', 'unit-46-tu', ${klasLama}, ${klasBaru},
                'Salah memilih unit pengolah saat pemberkasan', '${maker}'
            ) RETURNING id
        `)).rows[0].id;
        const denganKoreksi = async (setClause: string) => {
            try {
                await database.exec(`
                    BEGIN;
                    SELECT set_config('simsa.berkas_koreksi', '${koreksi}', true);
                    UPDATE rangkaian_surat SET ${setClause} WHERE id = '${berkasA}';
                    COMMIT;
                `);
            } catch (error) {
                await database.exec('ROLLBACK');
                throw error;
            }
        };
        // Masih pending: GUC saja tidak cukup.
        await expect(denganKoreksi(`unit_pengolah_id = 'unit-46-tu', klasifikasi_item_id = ${klasBaru}`))
            .rejects.toThrow(/tidak sesuai Koreksi Berkas/);
        await expect(database.exec(`
            UPDATE rangkaian_koreksi_berkas
            SET status = 'approved', diputuskan_by = '${maker}', diputuskan_at = now()
            WHERE id = '${koreksi}'
        `)).rejects.toThrow(/rangkaian_koreksi_maker_checker_check/);
        await database.exec(`
            UPDATE rangkaian_koreksi_berkas
            SET status = 'approved', diputuskan_by = '${checker}', diputuskan_at = now()
            WHERE id = '${koreksi}'
        `);
        // Nilai harus sama persis dengan baris koreksi.
        await expect(denganKoreksi(`unit_pengolah_id = 'unit-46-tu'`))
            .rejects.toThrow(/tidak sesuai Koreksi Berkas/);
        await denganKoreksi(`unit_pengolah_id = 'unit-46-tu', klasifikasi_item_id = ${klasBaru}`);
        const dikoreksi = await database.query(`
            SELECT status, unit_pengolah_id, klasifikasi_item_id FROM rangkaian_surat WHERE id = '${berkasA}'
        `);
        expect(dikoreksi.rows).toEqual([{
            status: 'diberkaskan', unit_pengolah_id: 'unit-46-tu', klasifikasi_item_id: klasBaru,
        }]);

        // GUC yang menunjuk koreksi rangkaian lain, koreksi yang ditolak, koreksi
        // yang sudah applied, GUC cacat, dan sisi "lama" yang tidak cocok — semuanya ditolak.
        const denganKoreksiGuc = async (guc: string, setClause: string) => {
            try {
                await database.exec(`
                    BEGIN;
                    SELECT set_config('simsa.berkas_koreksi', '${guc}', true);
                    UPDATE rangkaian_surat SET ${setClause} WHERE id = '${berkasA}';
                    COMMIT;
                `);
            } catch (error) {
                await database.exec('ROLLBACK');
                throw error;
            }
        };
        const buatKoreksi = async (
            rangkaianId: string, lamaUnit: string, baruUnit: string, lamaKlas: number, baruKlas: number,
        ) => (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_koreksi_berkas (
                rangkaian_id, unit_pengolah_lama, unit_pengolah_baru,
                klasifikasi_lama, klasifikasi_baru, alasan, diajukan_by
            ) VALUES ('${rangkaianId}', '${lamaUnit}', '${baruUnit}', ${lamaKlas}, ${baruKlas},
                'Koreksi tambahan untuk skenario penolakan', '${maker}') RETURNING id
        `)).rows[0].id;
        const setujuiKoreksi = (id: string) => database.exec(`
            UPDATE rangkaian_koreksi_berkas
            SET status = 'approved', diputuskan_by = '${checker}', diputuskan_at = now()
            WHERE id = '${id}'
        `);

        // Koreksi rangkaian lain (c), meskipun approved, tidak berlaku untuk berkasA.
        const koreksiLainRangkaian = await buatKoreksi(c, 'unit-46-tu', 'unit-46-dir', klasBaru, klasLama);
        await setujuiKoreksi(koreksiLainRangkaian);
        await expect(denganKoreksiGuc(koreksiLainRangkaian, `unit_pengolah_id = 'unit-46-dir', klasifikasi_item_id = ${klasLama}`))
            .rejects.toThrow(/tidak sesuai Koreksi Berkas/);

        // Koreksi yang ditolak (denied) tidak pernah berlaku.
        const koreksiDitolak = await buatKoreksi(berkasA, 'unit-46-tu', 'unit-46-dir', klasBaru, klasLama);
        await database.exec(`
            UPDATE rangkaian_koreksi_berkas
            SET status = 'denied', diputuskan_by = '${checker}', diputuskan_at = now()
            WHERE id = '${koreksiDitolak}'
        `);
        await expect(denganKoreksiGuc(koreksiDitolak, `unit_pengolah_id = 'unit-46-dir', klasifikasi_item_id = ${klasLama}`))
            .rejects.toThrow(/tidak sesuai Koreksi Berkas/);

        // Koreksi yang sudah diterapkan (applied) tidak dapat dipakai ulang.
        const koreksiTerapan = await buatKoreksi(berkasA, 'unit-46-tu', 'unit-46-dir', klasBaru, klasLama);
        await setujuiKoreksi(koreksiTerapan);
        await database.exec(`UPDATE rangkaian_koreksi_berkas SET status = 'applied' WHERE id = '${koreksiTerapan}'`);
        await expect(denganKoreksiGuc(koreksiTerapan, `unit_pengolah_id = 'unit-46-dir', klasifikasi_item_id = ${klasLama}`))
            .rejects.toThrow(/tidak sesuai Koreksi Berkas/);

        // GUC yang bukan UUID valid ditolak sebelum mencari baris koreksi.
        await expect(denganKoreksiGuc('bukan-uuid', `unit_pengolah_id = 'unit-46-dir', klasifikasi_item_id = ${klasLama}`))
            .rejects.toThrow(/Koreksi Berkas yang disetujui/);

        // Sisi "lama" yang tidak cocok dengan nilai baris saat ini tetap ditolak.
        const koreksiLamaSalah = await buatKoreksi(berkasA, 'unit-46-dir', 'unit-46-dir2', klasLama, klasBaru);
        await setujuiKoreksi(koreksiLamaSalah);
        await expect(denganKoreksiGuc(koreksiLamaSalah, `unit_pengolah_id = 'unit-46-dir2'`))
            .rejects.toThrow(/tidak sesuai Koreksi Berkas/);

        await expect(database.exec(`
            UPDATE rangkaian_surat SET status = 'digabung', digabung_ke_id = '${berkasA}' WHERE id = '${b}'
        `)).rejects.toThrow(/tidak dapat menjadi tujuan/);
        await database.exec(`
            UPDATE rangkaian_surat SET status = 'digabung', digabung_ke_id = '${c}' WHERE id = '${b}'
        `);
        // Siklus B→C→B mustahil: B sudah digabung.
        await expect(database.exec(`
            UPDATE rangkaian_surat SET status = 'digabung', digabung_ke_id = '${b}' WHERE id = '${c}'
        `)).rejects.toThrow(/tidak dapat menjadi tujuan/);
        await expect(database.exec(`
            UPDATE rangkaian_surat SET status = 'aktif', digabung_ke_id = NULL WHERE id = '${b}'
        `)).rejects.toThrow(/sudah digabung/);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('0046 menegakkan siklus hidup rangkaian_koreksi_berkas: pending -> approved/denied -> applied, dan terminal', async () => {
        const database = await createDatabase();
        // Semantik 0046 (termasuk jalur legacy rangkaian_id NULL dan lebih dari satu koreksi terbuka) diuji sebelum pengerasan 0048.
        const sebelum0048 = journal.entries.findIndex((entry) => entry.tag === '0048_rangkaian_pengerasan');
        for (const entry of sebelum0048 < 0 ? journal.entries : journal.entries.slice(0, sebelum0048)) {
            await applyMigration(database, entry);
        }

        const pengaju = '46000000-0000-4000-8000-0000000000c1';
        const checker1 = '46000000-0000-4000-8000-0000000000c2';
        const checker2 = '46000000-0000-4000-8000-0000000000c3';
        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES ('unit-46c-a', 'Unit C A'), ('unit-46c-b', 'Unit C B');
            INSERT INTO users (id, email, role) VALUES
                ('${pengaju}', 'pengaju-0046c@example.test', 'super_admin'),
                ('${checker1}', 'checker1-0046c@example.test', 'super_admin'),
                ('${checker2}', 'checker2-0046c@example.test', 'super_admin');
        `);
        const klasBaru = (await database.query<{ id: number }>(`
            INSERT INTO klasifikasi_arsip (kode, source_record_key, jenis, tipe)
            VALUES ('PT.02.01', 'test:0046c:0001', 'Uji siklus koreksi', 'substantif') RETURNING id
        `)).rows[0].id;
        const rangkaianId = (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_surat (kode, asal, unit_pencatat_id, judul, tahun)
            VALUES ('RS-2026-900101', 'surat_masuk', 'unit-46c-a', 'Uji siklus koreksi', 2026) RETURNING id
        `)).rows[0].id;

        // INSERT harus pending tanpa keputusan.
        await expect(database.exec(`
            INSERT INTO rangkaian_koreksi_berkas (
                rangkaian_id, unit_pengolah_lama, unit_pengolah_baru,
                klasifikasi_lama, klasifikasi_baru, alasan, diajukan_by, status
            ) VALUES ('${rangkaianId}', 'unit-46c-a', 'unit-46c-b', 1, ${klasBaru}, 'Alasan uji siklus koreksi', '${pengaju}', 'approved')
        `)).rejects.toThrow(/Koreksi berkas baru harus berstatus pending/);
        await expect(database.exec(`
            INSERT INTO rangkaian_koreksi_berkas (
                rangkaian_id, unit_pengolah_lama, unit_pengolah_baru,
                klasifikasi_lama, klasifikasi_baru, alasan, diajukan_by, diputuskan_by
            ) VALUES ('${rangkaianId}', 'unit-46c-a', 'unit-46c-b', 1, ${klasBaru}, 'Alasan uji siklus koreksi', '${pengaju}', '${checker1}')
        `)).rejects.toThrow(/Koreksi berkas baru harus berstatus pending/);

        const koreksiId = (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_koreksi_berkas (
                rangkaian_id, unit_pengolah_lama, unit_pengolah_baru,
                klasifikasi_lama, klasifikasi_baru, alasan, diajukan_by
            ) VALUES ('${rangkaianId}', 'unit-46c-a', 'unit-46c-b', 1, ${klasBaru}, 'Alasan uji siklus koreksi', '${pengaju}')
            RETURNING id
        `)).rows[0].id;

        // Pengajuan tidak dapat diubah setelah dibuat.
        await expect(database.exec(`
            UPDATE rangkaian_koreksi_berkas SET unit_pengolah_baru = 'unit-46c-a' WHERE id = '${koreksiId}'
        `)).rejects.toThrow(/Pengajuan koreksi berkas .* tidak dapat diubah/);
        await expect(database.exec(`
            UPDATE rangkaian_koreksi_berkas SET alasan = 'Alasan uji siklus koreksi diubah' WHERE id = '${koreksiId}'
        `)).rejects.toThrow(/Pengajuan koreksi berkas .* tidak dapat diubah/);

        // pending -> approved membutuhkan diputuskan_by/at terisi.
        await expect(database.exec(`
            UPDATE rangkaian_koreksi_berkas SET status = 'approved' WHERE id = '${koreksiId}'
        `)).rejects.toThrow(/harus mengisi diputuskan_by/);
        // Mengisi keputusan tanpa mengubah status (tetap pending) tetap ditolak;
        // baris pending tidak boleh punya diputuskan_by/at sama sekali.
        await expect(database.exec(`
            UPDATE rangkaian_koreksi_berkas
            SET diputuskan_by = '${checker1}', diputuskan_at = now()
            WHERE id = '${koreksiId}'
        `)).rejects.toThrow(/berstatus pending tidak boleh memiliki keputusan/);
        await expect(database.exec(`
            UPDATE rangkaian_koreksi_berkas SET diputuskan_by = '${checker1}' WHERE id = '${koreksiId}'
        `)).rejects.toThrow(/berstatus pending tidak boleh memiliki keputusan/);

        // Baris terpisah untuk jalur pending -> denied agar tidak mengganggu jalur approved di atas.
        const koreksiDitolakId = (await database.query<{ id: string }>(`
            INSERT INTO rangkaian_koreksi_berkas (
                rangkaian_id, unit_pengolah_lama, unit_pengolah_baru,
                klasifikasi_lama, klasifikasi_baru, alasan, diajukan_by
            ) VALUES ('${rangkaianId}', 'unit-46c-a', 'unit-46c-b', 1, ${klasBaru}, 'Alasan uji siklus koreksi ditolak', '${pengaju}')
            RETURNING id
        `)).rows[0].id;
        await database.exec(`
            UPDATE rangkaian_koreksi_berkas
            SET status = 'denied', diputuskan_by = '${checker1}', diputuskan_at = now()
            WHERE id = '${koreksiDitolakId}'
        `);
        // denied terminal: tidak ada transisi lanjutan sama sekali.
        await expect(database.exec(`
            UPDATE rangkaian_koreksi_berkas SET status = 'pending' WHERE id = '${koreksiDitolakId}'
        `)).rejects.toThrow(/berstatus denied tidak dapat berubah/);
        await expect(database.exec(`
            UPDATE rangkaian_koreksi_berkas SET status = 'approved' WHERE id = '${koreksiDitolakId}'
        `)).rejects.toThrow(/berstatus denied tidak dapat berubah/);
        // Keputusan yang sudah terisi tidak dapat diubah.
        await expect(database.exec(`
            UPDATE rangkaian_koreksi_berkas SET diputuskan_by = '${checker2}' WHERE id = '${koreksiDitolakId}'
        `)).rejects.toThrow(/Keputusan koreksi berkas .* tidak dapat diubah/);
        await expect(database.exec(`
            UPDATE rangkaian_koreksi_berkas SET diputuskan_at = now() WHERE id = '${koreksiDitolakId}'
        `)).rejects.toThrow(/Keputusan koreksi berkas .* tidak dapat diubah/);

        // Jalur approved -> applied yang sah (dipakai P5 setelah menerapkan perubahan).
        await expect(database.exec(`
            UPDATE rangkaian_koreksi_berkas SET status = 'applied' WHERE id = '${koreksiId}'
        `)).rejects.toThrow(/berstatus pending tidak dapat berubah/);
        await database.exec(`
            UPDATE rangkaian_koreksi_berkas
            SET status = 'approved', diputuskan_by = '${checker1}', diputuskan_at = now()
            WHERE id = '${koreksiId}'
        `);
        await database.exec(`
            UPDATE rangkaian_koreksi_berkas SET status = 'applied' WHERE id = '${koreksiId}'
        `);
        // applied terminal.
        await expect(database.exec(`
            UPDATE rangkaian_koreksi_berkas SET status = 'approved' WHERE id = '${koreksiId}'
        `)).rejects.toThrow(/berstatus applied tidak dapat berubah/);

        const hasil = await database.query<{ status: string }>(`
            SELECT status FROM rangkaian_koreksi_berkas WHERE id IN ('${koreksiId}', '${koreksiDitolakId}') ORDER BY status
        `);
        expect(hasil.rows).toEqual([{ status: 'applied' }, { status: 'denied' }]);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('0047 fail-closed pada id direktorat-* lalu melengkapi unit direktorat tanpa menimpa pengaturan admin', async () => {
        const database = await createDatabase();
        const index0047 = journal.entries.findIndex(({ tag }) => tag === '0047_unit_kerja_direktorat');
        expect(index0047).toBeGreaterThan(0);
        for (const entry of journal.entries.slice(0, index0047)) {
            await applyMigration(database, entry);
        }

        await database.exec(`
            INSERT INTO unit_kerja (id, name, parent_id, unit_type, can_receive_distribution) VALUES
                ('ditjen', 'Ditjen', NULL, NULL, true),
                ('sesditjen', 'Sekretariat Ditjen', NULL, NULL, true),
                ('dir_bppt', 'Nama BPPT dari admin', NULL, NULL, false),
                ('direktorat-bppt', 'Duplikat lama', NULL, NULL, true);
        `);
        await expect(applyMigration(database, journal.entries[index0047]))
            .rejects.toThrow(/0047: unit_kerja berpola direktorat-\*/);

        await database.exec(`DELETE FROM unit_kerja WHERE id = 'direktorat-bppt'`);
        await applyMigration(database, journal.entries[index0047]);
        // Idempoten untuk latihan pemulihan.
        await applyMigration(database, journal.entries[index0047]);

        const units = await database.query(`
            SELECT id, name, parent_id, unit_type, can_receive_distribution, is_unit_pengawas
            FROM unit_kerja ORDER BY id COLLATE "C"
        `);
        expect(units.rows).toEqual([
            { id: 'dir_bppt', name: 'Nama BPPT dari admin', parent_id: 'ditjen', unit_type: 'direktorat', can_receive_distribution: false, is_unit_pengawas: false },
            { id: 'dir_ktpp', name: 'Direktorat KTPP', parent_id: 'ditjen', unit_type: 'direktorat', can_receive_distribution: true, is_unit_pengawas: false },
            { id: 'dir_plp', name: 'Direktorat PLP', parent_id: 'ditjen', unit_type: 'direktorat', can_receive_distribution: true, is_unit_pengawas: false },
            { id: 'dir_ptep', name: 'Direktorat PTEP', parent_id: 'ditjen', unit_type: 'direktorat', can_receive_distribution: true, is_unit_pengawas: false },
            { id: 'ditjen', name: 'Ditjen', parent_id: null, unit_type: null, can_receive_distribution: true, is_unit_pengawas: true },
            { id: 'sesditjen', name: 'Sekretariat Ditjen', parent_id: 'ditjen', unit_type: 'sesditjen', can_receive_distribution: true, is_unit_pengawas: true },
        ]);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('0050 menghapus dir_plp yang keliru dibuat 0047, fail-closed bila sudah dirujuk', async () => {
        const database = await createDatabase();
        const index0047 = journal.entries.findIndex(({ tag }) => tag === '0047_unit_kerja_direktorat');
        const index0050 = journal.entries.findIndex(({ tag }) => tag === '0050_hapus_dir_plp');
        expect(index0050).toBeGreaterThan(index0047);
        for (const entry of journal.entries.slice(0, index0047)) {
            await applyMigration(database, entry);
        }
        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES ('ditjen', 'Ditjen'), ('sesditjen', 'Sekretariat Ditjen');
        `);
        for (const entry of journal.entries.slice(index0047, index0050)) {
            await applyMigration(database, entry);
        }
        expect((await database.query(`SELECT id FROM unit_kerja WHERE id = 'dir_plp'`)).rows).toHaveLength(1);

        await database.exec(`INSERT INTO disposisi_label_unit (label_norm, unit_kerja_id) VALUES ('plp', 'dir_plp')`);
        await expect(applyMigration(database, journal.entries[index0050]))
            .rejects.toThrow(/0050: unit dir_plp masih dirujuk 1 baris/);

        await database.exec(`DELETE FROM disposisi_label_unit WHERE label_norm = 'plp'`);
        await applyMigration(database, journal.entries[index0050]);
        // Idempoten: di produksi baris sudah dihapus manual, jadi 0050 menjadi no-op.
        await applyMigration(database, journal.entries[index0050]);

        const units = await database.query<{ id: string }>(`
            SELECT id FROM unit_kerja WHERE id LIKE 'dir\\_%' ORDER BY id COLLATE "C"
        `);
        expect(units.rows.map(row => row.id)).toEqual(['dir_bppt', 'dir_ktpp', 'dir_ptep']);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('memodelkan setiap kolom integrasi rangkaian di skema Drizzle', async () => {
        const database = await createDatabase();
        for (const entry of journal.entries) {
            await applyMigration(database, entry);
        }
        const actual = await database.query<{ table_name: string; column_name: string }>(`
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND (
                  table_name IN (
                      'rangkaian_surat', 'rangkaian_anggota', 'rangkaian_relasi',
                      'rangkaian_peserta', 'rangkaian_koreksi_berkas', 'disposisi_label_unit'
                  )
                  OR (table_name, column_name) IN (
                      ('unit_kerja', 'is_unit_pengawas'),
                      ('surat_keluar', 'asal_naskah'),
                      ('surat_distributions', 'rangkaian_id'),
                      ('surat_distributions', 'batas_waktu'),
                      ('surat_distributions', 'penanggung_jawab'),
                      ('surat_distributions', 'processed_by'),
                      ('surat_distributions', 'penyelesaian_surat_keluar_id'),
                      ('surat_distributions', 'catatan_penyelesaian'),
                      ('surat_distributions', 'ditutup_pengawas')
                  )
              )
        `);
        expect(actual.rows).toHaveLength(75);
        const modeled = new Set(
            expectedSchemaColumns().map(({ tableName, columnName }) => `${tableName}.${columnName}`),
        );
        const unmodeled = actual.rows
            .map(({ table_name, column_name }) => `${table_name}.${column_name}`)
            .filter((name) => !modeled.has(name))
            .sort();
        expect(unmodeled).toEqual([]);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('0048 menolak pengerasan selama masih ada disposisi tanpa rangkaian_id', async () => {
        const database = await createDatabase();
        const hardening = journal.entries.find((entry) => entry.tag === '0048_rangkaian_pengerasan');
        expect(hardening).toBeDefined();
        for (const entry of journal.entries) {
            if (entry.tag === hardening!.tag) break;
            await applyMigration(database, entry);
        }
        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES ('unit-p5-asal', 'Asal P5'), ('unit-p5-tujuan', 'Tujuan P5');
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun)
            VALUES ('00000000-0000-4000-8000-000000000481', 'unit-p5-asal', 1, 2026);
            INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status)
            VALUES ('00000000-0000-4000-8000-000000000481', 'unit-p5-asal', 'unit-p5-tujuan', 'sent');
        `);
        await expect(applyMigration(database, hardening!))
            .rejects.toThrow(/0048: surat_distributions\.rangkaian_id masih NULL/);
    }, PGLITE_MIGRATION_TIMEOUT_MS);

    it('0048 mengeraskan rangkaian_id dan membatasi satu Koreksi Berkas terbuka', async () => {
        const database = await createDatabase();
        for (const entry of journal.entries) await applyMigration(database, entry);

        const column = await database.query<{ is_nullable: string }>(`
            SELECT is_nullable FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'surat_distributions' AND column_name = 'rangkaian_id'`);
        expect(column.rows).toEqual([{ is_nullable: 'NO' }]);

        const { klasA, klasB } = await seedRangkaianBase(database);
        const { rangkaianId } = await seedBerkasDiberkaskan(database, klasA);
        const insertKoreksi = (unit: string) => database.exec(`
            INSERT INTO rangkaian_koreksi_berkas (rangkaian_id, unit_pengolah_lama, unit_pengolah_baru,
              klasifikasi_lama, klasifikasi_baru, alasan, diajukan_by)
            VALUES ('${rangkaianId}', 'dir_bppt', '${unit}', ${klasA}, ${klasB}, 'Salah pilih saat pemberkasan', '${P5_IDS.superA}')`);
        await insertKoreksi('dir_ptep');
        await expect(insertKoreksi('dir_bppt')).rejects.toThrow(/rangkaian_koreksi_berkas_terbuka_uidx/);
        // Trigger BEFORE INSERT (0046) menolak status non-pending lebih dulu; CHECK berjalan sebelum indeks unik.
        await expect(database.exec(`
            INSERT INTO rangkaian_koreksi_berkas (rangkaian_id, unit_pengolah_lama, unit_pengolah_baru,
              klasifikasi_lama, klasifikasi_baru, alasan, diajukan_by)
            VALUES ('${rangkaianId}', 'dir_bppt', 'dir_bppt', ${klasA}, ${klasA}, 'Tidak mengubah apa pun', '${P5_IDS.superA}')`))
            .rejects.toThrow(/rangkaian_koreksi_berkas_berubah_check/);
        const putusan = await database.query<{ def: string }>(`
            SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'rangkaian_koreksi_berkas_putusan_check'`);
        expect(putusan.rows).toHaveLength(1);
        expect(putusan.rows[0].def).toMatch(/diputuskan_by IS NULL/);
    }, PGLITE_MIGRATION_TIMEOUT_MS);
});
