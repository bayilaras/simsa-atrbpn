import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterEach, describe, expect, it } from 'vitest';

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
    for (const entry of journal.entries) {
        for (const statement of statements(entry.tag)) await database.exec(statement);
    }
    return database;
}

afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe('regulatory maker-checker database invariants', () => {
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
