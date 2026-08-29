import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '../db/schema/index.js';

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

function migrationStatements(tag: string): string[] {
    return readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean);
}

async function createDatabase(): Promise<PGlite> {
    const database = new PGlite({ extensions: { pgcrypto } });
    openDatabases.push(database);
    await database.waitReady;
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
    }, 30_000);

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
    }, 30_000);

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
    }, 30_000);

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
    }, 30_000);

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
    }, 30_000);

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
            INSERT INTO autentikasi (
                nomor_berita_acara, tanggal_autentikasi, kegiatan, jumlah_arsip, file_lampiran
            ) VALUES ('BA-INVALID', '2026-08-28', 'Uji locator', 1, 'private-locator-only')
        `)).rejects.toThrow(/autentikasi_file_lampiran_metadata_check|check constraint/i);
    }, 30_000);

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
    }, 30_000);

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
    }, 30_000);

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
    }, 30_000);

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
    }, 30_000);
});
