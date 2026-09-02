import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterEach, describe, expect, it } from 'vitest';
import { enterTestMigratorRole } from './helpers/database-role-fixture.js';

type JournalEntry = { tag: string };
const migrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
) as { entries: JournalEntry[] };
const databases: PGlite[] = [];

function statements(tag: string): string[] {
    return readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean);
}

async function migratedDatabase(): Promise<PGlite> {
    const database = new PGlite({ extensions: { pgcrypto } });
    databases.push(database);
    await database.waitReady;
    await enterTestMigratorRole(database);
    for (const entry of journal.entries) {
        for (const statement of statements(entry.tag)) await database.exec(statement);
    }
    return database;
}

afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe('regulatory maker-checker database invariants', () => {
    it('rejects a GCS regulatory source without an exact object generation', async () => {
        const database = await migratedDatabase();
        const ruleSet = '550e8400-e29b-41d4-a716-446655440101';

        await expect(database.exec(`
            INSERT INTO regulatory_rule_sets (
              id, instrument_type, version, name, legal_basis,
              regulation_number, status, effective_from, source_document_blob_url
            ) VALUES (
              '${ruleSet}', 'klasifikasi', 'gcs-null-generation', 'Draft GCS tanpa generation',
              'Peraturan uji', 'UJI/GCS/NULL', 'draft', '2026-01-01',
              'gs://simsa-private/regulatory-sources/${ruleSet}/source.pdf'
            )
        `)).rejects.toThrow(/regulatory_rule_sets_source_generation_check/i);
    }, 30_000);

    it('accepts a numeric GCS generation while the regulatory rule set is draft', async () => {
        const database = await migratedDatabase();
        const ruleSet = '550e8400-e29b-41d4-a716-446655440102';

        await database.exec(`
            INSERT INTO regulatory_rule_sets (
              id, instrument_type, version, name, legal_basis,
              regulation_number, status, effective_from,
              source_document_blob_url, source_document_object_generation
            ) VALUES (
              '${ruleSet}', 'klasifikasi', 'gcs-numeric-generation', 'Draft GCS pinned',
              'Peraturan uji', 'UJI/GCS/NUMERIC', 'draft', '2026-01-01',
              'gs://simsa-private/regulatory-sources/${ruleSet}/source.pdf',
              '1743436800123456'
            )
        `);

        const storedResult = await database.query<{
            status: string;
            source_document_object_generation: string;
        }>(`
            SELECT status, source_document_object_generation
            FROM regulatory_rule_sets
            WHERE id = '${ruleSet}'
        `);
        const [stored] = storedResult.rows;
        expect(stored).toEqual({
            status: 'draft',
            source_document_object_generation: '1743436800123456',
        });
    }, 30_000);

    it('makes the exact GCS generation immutable after draft is submitted', async () => {
        const database = await migratedDatabase();
        const ruleSet = '550e8400-e29b-41d4-a716-446655440103';
        const maker = '550e8400-e29b-41d4-a716-446655440104';

        await database.exec(`
            INSERT INTO users (id, email, role)
            VALUES ('${maker}', 'gcs-maker@example.test', 'super_admin');
            INSERT INTO regulatory_rule_sets (
              id, instrument_type, version, name, legal_basis,
              regulation_number, status, effective_from, created_by,
              source_document_blob_url, source_document_object_generation
            ) VALUES (
              '${ruleSet}', 'klasifikasi', 'gcs-submitted-generation', 'Draft GCS submitted',
              'Peraturan uji', 'UJI/GCS/SUBMITTED', 'draft', '2026-01-01', '${maker}',
              'gs://simsa-private/regulatory-sources/${ruleSet}/source.pdf',
              '1743436800123456'
            );
            UPDATE regulatory_rule_sets SET
              status = 'submitted', submitted_by = '${maker}', submitted_at = now(),
              submission_note = 'Dokumen GCS exact-generation siap ditelaah.'
            WHERE id = '${ruleSet}';
        `);

        await expect(database.exec(`
            UPDATE regulatory_rule_sets
            SET source_document_object_generation = '1743436800654321'
            WHERE id = '${ruleSet}'
        `)).rejects.toThrow(/generation is immutable|content is immutable/i);

        const storedResult = await database.query<{
            status: string;
            source_document_object_generation: string;
        }>(`
            SELECT status, source_document_object_generation
            FROM regulatory_rule_sets
            WHERE id = '${ruleSet}'
        `);
        const [stored] = storedResult.rows;
        expect(stored).toEqual({
            status: 'submitted',
            source_document_object_generation: '1743436800123456',
        });
    }, 30_000);

    it('requires a generation on hidden regulatory GCS attachments and queues the pinned object', async () => {
        const database = await migratedDatabase();
        const ruleSet = '550e8400-e29b-41d4-a716-446655440105';
        const rejectedAttachment = '550e8400-e29b-41d4-a716-446655440106';
        const queuedAttachment = '550e8400-e29b-41d4-a716-446655440107';
        const locator = `gs://simsa-private/regulatory-sources/${ruleSet}/source.pdf`;

        await expect(database.exec(`
            INSERT INTO file_attachments (
              id, entity_type, entity_id, file_name, file_url,
              mime_type, size_bytes, storage_access, integrity_status, malware_scan_status
            ) VALUES (
              '${rejectedAttachment}', 'regulatory_rule_set', '${ruleSet}', 'source.pdf', '${locator}',
              'application/pdf', 4096, 'private', 'baseline_recorded', 'not_scanned'
            )
        `)).rejects.toThrow(/file_attachments_object_generation_check/i);

        await database.exec(`
            INSERT INTO file_attachments (
              id, entity_type, entity_id, file_name, file_url, object_generation,
              mime_type, size_bytes, storage_access, integrity_status, malware_scan_status
            ) VALUES (
              '${queuedAttachment}', 'regulatory_rule_set', '${ruleSet}', 'source.pdf', '${locator}',
              '1743436800123456', 'application/pdf', 4096, 'private',
              'baseline_recorded', 'not_scanned'
            )
        `);

        const queued = await database.query<{
            id: string;
            entity_type: string;
            object_generation: string;
            malware_scan_status: string;
        }>(`
            SELECT id, entity_type, object_generation, malware_scan_status
            FROM file_attachments
            WHERE entity_type = 'regulatory_rule_set'
              AND malware_scan_status = 'not_scanned'
              AND id = '${queuedAttachment}'
        `);
        expect(queued.rows).toEqual([{
            id: queuedAttachment,
            entity_type: 'regulatory_rule_set',
            object_generation: '1743436800123456',
            malware_scan_status: 'not_scanned',
        }]);
    }, 30_000);

    it('rejects self-review/self-approval and keeps workflow/audit evidence immutable', async () => {
        const database = await migratedDatabase();
        const ruleSet = '10102018-1010-4010-8010-000000000010';
        const maker = '550e8400-e29b-41d4-a716-446655440011';
        const reviewer = '550e8400-e29b-41d4-a716-446655440012';
        const approver = '550e8400-e29b-41d4-a716-446655440013';
        const event = '550e8400-e29b-41d4-a716-446655440014';
        const childEvent = '550e8400-e29b-41d4-a716-446655440016';
        const siblingEvent = '550e8400-e29b-41d4-a716-446655440017';
        const duplicateHashEvent = '550e8400-e29b-41d4-a716-446655440018';
        const duplicateGenesisEvent = '550e8400-e29b-41d4-a716-446655440019';
        const candidate = '550e8400-e29b-41d4-a716-446655440015';
        const hash = 'a'.repeat(64);

        await database.exec(`
            INSERT INTO users (id, email, role) VALUES
              ('${maker}', 'maker@example.test', 'super_admin'),
              ('${reviewer}', 'reviewer@example.test', 'super_admin'),
              ('${approver}', 'approver@example.test', 'super_admin');
            UPDATE regulatory_rule_sets SET created_by = '${maker}' WHERE id = '${ruleSet}';
            UPDATE regulatory_rule_sets SET
              status = 'submitted', submitted_by = '${maker}', submitted_at = now(),
              submission_note = 'Manifest dan isi sudah diperiksa oleh penyusun.'
            WHERE id = '${ruleSet}';
        `);

        await expect(database.exec(`
            UPDATE regulatory_rule_sets SET
              status = 'reviewed', reviewed_by = '${maker}', reviewed_at = now(),
              review_note = 'Penyusun mencoba menelaah versinya sendiri.'
            WHERE id = '${ruleSet}'
        `)).rejects.toThrow(/independent reviewer/i);

        await database.exec(`
            UPDATE regulatory_rule_sets SET
              status = 'reviewed', reviewed_by = '${reviewer}', reviewed_at = now(),
              review_note = 'Penelaah independen telah memeriksa seluruh bukti.'
            WHERE id = '${ruleSet}';
        `);
        await expect(database.exec(`
            UPDATE regulatory_rule_sets SET
              status = 'approved', approved_by = '${reviewer}', approved_at = now(),
              approval_note = 'Penelaah mencoba menyetujui hasil telaah sendiri.'
            WHERE id = '${ruleSet}'
        `)).rejects.toThrow(/independent approver/i);

        await database.exec(`
            UPDATE regulatory_rule_sets SET
              status = 'approved', approved_by = '${approver}', approved_at = now(),
              approval_note = 'Penyetuju independen menyatakan edisi layak diterbitkan.'
            WHERE id = '${ruleSet}';
        `);
        await expect(database.exec(`
            UPDATE regulatory_rule_sets SET approval_note = 'Catatan diubah setelah final.'
            WHERE id = '${ruleSet}'
        `)).rejects.toThrow(/immutable/i);

        await database.exec(`
            INSERT INTO regulatory_rule_events (
              id, rule_set_id, instrument_type, entity_type, action,
              event_hash, created_at
            ) VALUES (
              '${event}', '${ruleSet}', 'klasifikasi', 'rule_set', 'approve',
              '${hash}', now()
            );
        `);
        await expect(database.exec(`
            UPDATE regulatory_rule_events SET action = 'tampered' WHERE id = '${event}'
        `)).rejects.toThrow(/append-only/i);

        await expect(database.exec(`
            INSERT INTO regulatory_rule_events (
              id, rule_set_id, instrument_type, entity_type, action,
              event_hash, created_at
            ) VALUES (
              '${duplicateGenesisEvent}', '${ruleSet}', 'klasifikasi', 'rule_set', 'fork-genesis',
              '${'b'.repeat(64)}', now()
            )
        `)).rejects.toThrow(/regulatory_rule_events_genesis_unique/i);

        await database.exec(`
            INSERT INTO regulatory_rule_events (
              id, rule_set_id, instrument_type, entity_type, action,
              previous_event_hash, event_hash, created_at
            ) VALUES (
              '${childEvent}', '${ruleSet}', 'klasifikasi', 'rule_set', 'child',
              '${hash}', '${'b'.repeat(64)}', now() + interval '1 millisecond'
            )
        `);
        await expect(database.exec(`
            INSERT INTO regulatory_rule_events (
              id, rule_set_id, instrument_type, entity_type, action,
              previous_event_hash, event_hash, created_at
            ) VALUES (
              '${siblingEvent}', '${ruleSet}', 'klasifikasi', 'rule_set', 'fork-child',
              '${hash}', '${'c'.repeat(64)}', now() + interval '2 milliseconds'
            )
        `)).rejects.toThrow(/regulatory_rule_events_previous_hash_unique/i);

        await expect(database.exec(`
            INSERT INTO regulatory_rule_events (
              id, rule_set_id, instrument_type, entity_type, action,
              event_hash, created_at
            ) VALUES (
              '${duplicateHashEvent}', '08002020-0800-4080-8080-000000000008',
              'jra', 'rule_set', 'duplicate-hash', '${hash}', now()
            )
        `)).rejects.toThrow(/regulatory_rule_events_event_hash_unique/i);

        await expect(database.exec(`
            INSERT INTO regulatory_rule_sets (
              id, instrument_type, version, name, legal_basis,
              regulation_number, status, effective_from, source_document_blob_url
            ) VALUES (
              '${candidate}', 'klasifikasi', 'invalid-public-source', 'Draft uji',
              'Peraturan uji', 'UJI/1', 'draft', '2026-01-01',
              'https://store.blob.vercel-storage.com/regulatory-sources/${candidate}/source.pdf'
            )
        `)).rejects.toThrow(/source_blob_check/i);

        await expect(database.exec(`
            INSERT INTO regulatory_rule_sets (
              id, instrument_type, version, name, legal_basis,
              regulation_number, status, effective_from, source_document_blob_url
            ) VALUES (
              '${candidate}', 'klasifikasi', 'wrong-bound-source', 'Draft uji',
              'Peraturan uji', 'UJI/1', 'draft', '2026-01-01',
              'https://store.private.blob.vercel-storage.com/regulatory-sources/550e8400-e29b-41d4-a716-446655440099/source.pdf'
            )
        `)).rejects.toThrow(/source_blob_check/i);

        await database.exec(`
            INSERT INTO regulatory_rule_sets (
              id, instrument_type, version, name, legal_basis,
              regulation_number, status, effective_from, source_document_blob_url
            ) VALUES (
              '${candidate}', 'klasifikasi', 'private-source', 'Draft uji',
              'Peraturan uji', 'UJI/1', 'draft', '2026-01-01',
              'https://store.private.blob.vercel-storage.com/regulatory-sources/${candidate}/source.pdf'
            )
        `);
    }, 30_000);
});
