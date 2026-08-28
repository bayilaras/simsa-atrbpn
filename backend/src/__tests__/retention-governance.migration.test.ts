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

async function databaseBeforeMigration(tag: string): Promise<PGlite> {
    const database = new PGlite({ extensions: { pgcrypto } });
    databases.push(database);
    await database.waitReady;
    for (const entry of journal.entries) {
        if (entry.tag === tag) break;
        for (const statement of statements(entry.tag)) await database.exec(statement);
    }
    return database;
}

afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe('retention governance database invariants', () => {
    it('migrates a legacy acknowledged manifest to terminal archive state without mutating evidence rows', async () => {
        const database = await databaseBeforeMigration('0020_permanent_transfer_lifecycle');
        const maker = '650e8400-e29b-41d4-a716-446655440001';
        const checker = '650e8400-e29b-41d4-a716-446655440002';
        const archive = '650e8400-e29b-41d4-a716-446655440003';
        const appraisal = '650e8400-e29b-41d4-a716-446655440004';
        const decision = '650e8400-e29b-41d4-a716-446655440005';
        const manifest = '650e8400-e29b-41d4-a716-446655440006';
        const hash = 'b'.repeat(64);

        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES ('ditjen', 'Direktorat Jenderal');
            INSERT INTO users (id, email, role, unit_kerja_id) VALUES
              ('${maker}', 'maker-legacy@example.test', 'admin_dirjen', 'ditjen'),
              ('${checker}', 'checker-legacy@example.test', 'admin_dirjen', 'ditjen');
            INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun)
              VALUES ('${archive}', 'ditjen', 'masuk', 2026);
            INSERT INTO jra_appraisal_cases (
              id, arsip_id, case_type, reason, proposed_outcome,
              proposed_rationale, assessor_id
            ) VALUES (
              '${appraisal}', '${archive}', 'dinilai_kembali',
              'Penilaian historis diperlukan untuk bukti transfer permanen.', 'permanen',
              'Arsip memiliki nilai guna sekunder dan ditetapkan permanen.', '${maker}'
            );
            INSERT INTO jra_appraisal_evidence (
              case_id, label, evidence_uri, evidence_sha256, created_by
            ) VALUES (
              '${appraisal}', 'Bukti historis', 'urn:legacy:evidence', '${hash}', '${maker}'
            );
            UPDATE jra_appraisal_cases SET status = 'in_review',
              submission_snapshot = '{"schemaVersion":1}'::jsonb,
              submission_sha256 = '${hash}', submitted_at = now(), updated_at = now()
            WHERE id = '${appraisal}';
            INSERT INTO jra_appraisal_decisions (
              id, case_id, arsip_id, decision_status, outcome, rationale,
              decision_snapshot, decision_sha256, assessor_id, reviewer_id
            ) VALUES (
              '${decision}', '${appraisal}', '${archive}', 'approved', 'permanen',
              'Keputusan historis telah diperiksa.', '{"schemaVersion":1}'::jsonb,
              '${hash}', '${maker}', '${checker}'
            );
            UPDATE jra_appraisal_cases SET status = 'approved', reviewer_id = '${checker}',
              reviewed_at = now(), review_reason = 'Keputusan historis telah diperiksa.',
              updated_at = now() WHERE id = '${appraisal}';
            INSERT INTO permanent_transfer_manifests (
              id, unit_kerja_id, manifest_number, destination, created_by
            ) VALUES (
              '${manifest}', 'ditjen', 'LEGACY-ACK-001',
              'Unit Kearsipan Kementerian', '${maker}'
            );
            INSERT INTO permanent_transfer_manifest_items (
              manifest_id, arsip_id, appraisal_decision_id, object_uri, object_sha256
            ) VALUES (
              '${manifest}', '${archive}', '${decision}', 'urn:legacy:object', '${hash}'
            );
            INSERT INTO permanent_transfer_events (
              manifest_id, event_type, event_at, reference_number, counterparty,
              document_uri, document_sha256, actor_id
            ) VALUES
              ('${manifest}', 'handover', '2026-08-20T00:00:00Z', 'LEGACY-BAST',
               'Unit Kearsipan', 'urn:legacy:bast', '${hash}', '${maker}'),
              ('${manifest}', 'acknowledgement', '2026-08-21T00:00:00Z', 'LEGACY-ACK',
               'Unit Kearsipan', 'urn:legacy:ack', '${hash}', '${checker}');
        `);

        for (const statement of statements('0020_permanent_transfer_lifecycle')) {
            await database.exec(statement);
        }
        const archiveState = await database.query<{ disposal_status: string; disposal_batch_id: string }>(`
            SELECT disposal_status, disposal_batch_id FROM arsip WHERE id = '${archive}'
        `);
        expect(archiveState.rows[0]).toEqual({
            disposal_status: 'executed',
            disposal_batch_id: manifest,
        });
        const evidence = await database.query<{ object_uri: string; event_count: number }>(`
            SELECT item.object_uri,
              (SELECT count(*)::int FROM permanent_transfer_events event
               WHERE event.manifest_id = item.manifest_id) AS event_count
            FROM permanent_transfer_manifest_items item
            WHERE item.manifest_id = '${manifest}'
        `);
        expect(evidence.rows[0]).toEqual({ object_uri: 'urn:legacy:object', event_count: 2 });
    }, 30_000);

    it('enforces append-only evidence, independent review, and ordered permanent transfer', async () => {
        const database = await migratedDatabase();
        const assessor = '550e8400-e29b-41d4-a716-446655440001';
        const reviewer = '550e8400-e29b-41d4-a716-446655440002';
        const archive = '550e8400-e29b-41d4-a716-446655440003';
        const event = '550e8400-e29b-41d4-a716-446655440004';
        const appraisal = '550e8400-e29b-41d4-a716-446655440005';
        const decision = '550e8400-e29b-41d4-a716-446655440006';
        const cancelledManifest = '550e8400-e29b-41d4-a716-446655440007';
        const ruleSnapshot = '550e8400-e29b-41d4-a716-446655440008';
        const attachment = '550e8400-e29b-41d4-a716-446655440009';
        const manifest = '550e8400-e29b-41d4-a716-446655440010';
        const cancellation = '550e8400-e29b-41d4-a716-446655440011';
        const hash = 'a'.repeat(64);

        await database.exec(`
            INSERT INTO unit_kerja (id, name) VALUES ('ditjen', 'Direktorat Jenderal');
            INSERT INTO users (id, email, role, unit_kerja_id) VALUES
              ('${assessor}', 'assessor@example.test', 'admin_dirjen', 'ditjen'),
              ('${reviewer}', 'reviewer@example.test', 'admin_dirjen', 'ditjen');
            INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun)
              VALUES ('${archive}', 'ditjen', 'masuk', 2026);
            INSERT INTO arsip_rule_snapshots (
              id, arsip_id, revision, status, snapshot, snapshot_sha256,
              reason, created_by
            ) VALUES (
              '${ruleSnapshot}', '${archive}', 1, 'verified',
              '{"schemaVersion":1,"retention":{"dispositionCode":"dinilai_kembali"}}'::jsonb,
              '${hash}', 'Snapshot aturan telah diverifikasi.', '${assessor}'
            );
            UPDATE arsip SET
              current_rule_snapshot_id = '${ruleSnapshot}',
              retention_decision_hash = '${hash}',
              rule_provenance_status = 'verified'
            WHERE id = '${archive}';
            INSERT INTO retention_trigger_events (
              id, arsip_id, revision, event_type, event_date, label,
              evidence_uri, evidence_sha256, actor_id
            ) VALUES (
              '${event}', '${archive}', 1, 'berkas_ditutup', '2026-08-20',
              'Penutupan berkas final', 'urn:simsa:evidence:1', '${hash}', '${assessor}'
            );
        `);

        await expect(database.exec(`
            UPDATE retention_trigger_events SET label = 'Diubah' WHERE id = '${event}'
        `)).rejects.toThrow(/append-only/i);
        await expect(database.exec(`
            UPDATE arsip SET
              retention_trigger_type = 'berkas_ditutup',
              retention_trigger_label = 'Pemicu mentah',
              retention_trigger_date = '2026-08-20',
              retention_trigger_evidence = 'urn:simsa:evidence:raw'
            WHERE id = '${archive}'
        `)).rejects.toThrow(/verified current event/i);
        await expect(database.exec(`
            INSERT INTO retention_trigger_verifications (
              event_id, verdict, note, verifier_id
            ) VALUES (
              '${event}', 'verified', 'Bukti telah diperiksa secara lengkap.', '${assessor}'
            )
        `)).rejects.toThrow(/cannot verify/i);
        await database.exec(`
            INSERT INTO retention_trigger_verifications (
              event_id, verdict, note, verifier_id
            ) VALUES (
              '${event}', 'verified', 'Bukti telah diperiksa secara lengkap.', '${reviewer}'
            )
        `);
        await database.exec(`
            UPDATE arsip SET
              current_retention_trigger_event_id = '${event}',
              retention_trigger_type = 'berkas_ditutup',
              retention_trigger_label = 'Penutupan berkas final',
              retention_trigger_date = '2026-08-20',
              retention_trigger_evidence = 'urn:simsa:evidence:1'
            WHERE id = '${archive}'
        `);

        await database.exec(`
            INSERT INTO jra_appraisal_cases (
              id, arsip_id, case_type, reason, proposed_outcome,
              proposed_rationale, assessor_id
            ) VALUES (
              '${appraisal}', '${archive}', 'dinilai_kembali',
              'Penilaian manusia diperlukan untuk memastikan nilai guna sekunder.',
              'permanen',
              'Berkas merupakan bukti kebijakan kelembagaan yang harus disimpan.',
              '${assessor}'
            );
        `);
        await expect(database.exec(`
            INSERT INTO jra_appraisal_evidence (
              case_id, label, evidence_uri, evidence_sha256, created_by
            ) VALUES (
              '${appraisal}', 'Bukti keputusan', 'urn:simsa:evidence:2', '${hash}', '${reviewer}'
            )
        `)).rejects.toThrow(/only the case assessor/i);
        await database.exec(`
            INSERT INTO jra_appraisal_evidence (
              case_id, label, evidence_uri, evidence_sha256, created_by
            ) VALUES (
              '${appraisal}', 'Bukti keputusan', 'urn:simsa:evidence:2', '${hash}', '${assessor}'
            );
            UPDATE jra_appraisal_cases SET
              status = 'in_review',
              submission_snapshot = '{"schemaVersion":1}'::jsonb,
              submission_sha256 = '${hash}',
              submitted_at = now(),
              updated_at = now()
            WHERE id = '${appraisal}';
        `);
        await expect(database.exec(`
            INSERT INTO jra_appraisal_decisions (
              case_id, arsip_id, decision_status, outcome, rationale,
              decision_snapshot, decision_sha256, assessor_id, reviewer_id
            ) VALUES (
              '${appraisal}', '${archive}', 'approved', 'permanen',
              'Keputusan telah sesuai bukti.', '{"schemaVersion":1}'::jsonb,
              '${hash}', '${assessor}', '${assessor}'
            )
        `)).rejects.toThrow();
        await database.exec(`
            INSERT INTO jra_appraisal_decisions (
              id, case_id, arsip_id, decision_status, outcome, rationale,
              decision_snapshot, decision_sha256, assessor_id, reviewer_id
            ) VALUES (
              '${decision}', '${appraisal}', '${archive}', 'approved', 'permanen',
              'Keputusan telah sesuai bukti.',
              '{"schemaVersion":1,"arsipId":"${archive}","submissionSnapshot":{"ruleSnapshot":{"id":"${ruleSnapshot}","sha256":"${hash}"},"archive":{"retentionDecisionHash":"${hash}"},"retentionTrigger":{"event":{"id":"${event}"},"verification":{"verdict":"verified","verifierId":"${reviewer}"}}}}'::jsonb,
              '${hash}', '${assessor}', '${reviewer}'
            );
            UPDATE jra_appraisal_cases SET
              status = 'approved', reviewer_id = '${reviewer}', reviewed_at = now(),
              review_reason = 'Keputusan telah sesuai bukti.', updated_at = now()
            WHERE id = '${appraisal}';
            UPDATE arsip SET current_appraisal_decision_id = '${decision}'
            WHERE id = '${archive}';
        `);
        await expect(database.exec(`
            UPDATE jra_appraisal_decisions SET rationale = 'Diubah sesudah final'
            WHERE id = '${decision}'
        `)).rejects.toThrow(/append-only/i);

        await database.exec(`
            INSERT INTO file_attachments (
              id, entity_type, entity_id, file_name, file_url, sha256,
              storage_access, integrity_status, last_fixity_check_at,
              malware_scan_status
            ) VALUES (
              '${attachment}', 'arsip', '${archive}', 'paket-transfer.pdf',
              'https://example.private.blob.vercel-storage.com/paket-transfer.pdf',
              '${hash}', 'private', 'verified', now(), 'clean'
            );
            INSERT INTO permanent_transfer_manifests (
              id, unit_kerja_id, manifest_number, destination, created_by
            ) VALUES (
              '${cancelledManifest}', 'ditjen', 'MANIFEST-001',
              'Unit Kearsipan Kementerian', '${assessor}'
            );
            UPDATE arsip SET disposal_status = 'proposed_serah',
              disposal_batch_id = '${cancelledManifest}' WHERE id = '${archive}';
            INSERT INTO permanent_transfer_manifest_items (
              manifest_id, arsip_id, appraisal_decision_id, object_uri, object_sha256,
              evidence_attachment_id, evidence_verified_at
            ) VALUES (
              '${cancelledManifest}', '${archive}', '${decision}',
              'attachment:${attachment}', '${hash}', '${attachment}', now()
            );
        `);
        await database.exec(`
            INSERT INTO permanent_transfer_cancellation_requests (
              id, manifest_id, reason, requested_by
            ) VALUES (
              '${cancellation}', '${cancelledManifest}',
              'Manifest memuat bukti yang salah dan harus disusun ulang.', '${assessor}'
            )
        `);
        await expect(database.exec(`
            UPDATE permanent_transfer_cancellation_requests SET
              status = 'approved', reviewed_by = '${assessor}', reviewed_at = now(),
              review_note = 'Pembatalan diperiksa oleh pemohon sendiri.'
            WHERE id = '${cancellation}'
        `)).rejects.toThrow(/independent|review/i);
        await database.exec(`
            UPDATE permanent_transfer_cancellation_requests SET
              status = 'approved', reviewed_by = '${reviewer}', reviewed_at = now(),
              review_note = 'Pembatalan diperiksa dan bukti kesalahan dinyatakan lengkap.'
            WHERE id = '${cancellation}'
        `);
        const released = await database.query<{ disposal_status: string; disposal_batch_id: string | null }>(`
            SELECT disposal_status, disposal_batch_id FROM arsip WHERE id = '${archive}'
        `);
        expect(released.rows[0]).toEqual({ disposal_status: 'active', disposal_batch_id: null });

        // Historical occurrence no longer blocks a corrected manifest; the
        // active archive reservation remains the concurrency authority.
        await database.exec(`
            INSERT INTO permanent_transfer_manifests (
              id, unit_kerja_id, manifest_number, destination,
              supersedes_manifest_id, created_by
            ) VALUES (
              '${manifest}', 'ditjen', 'MANIFEST-002',
              'Unit Kearsipan Kementerian', '${cancelledManifest}', '${assessor}'
            );
            UPDATE arsip SET disposal_status = 'proposed_serah',
              disposal_batch_id = '${manifest}' WHERE id = '${archive}';
            INSERT INTO permanent_transfer_manifest_items (
              manifest_id, arsip_id, appraisal_decision_id, object_uri, object_sha256,
              evidence_attachment_id, evidence_verified_at
            ) VALUES (
              '${manifest}', '${archive}', '${decision}',
              'attachment:${attachment}', '${hash}', '${attachment}', now()
            );
        `);
        const replacement = await database.query<{ supersedes_manifest_id: string }>(`
            SELECT supersedes_manifest_id FROM permanent_transfer_manifests
            WHERE id = '${manifest}'
        `);
        expect(replacement.rows[0]?.supersedes_manifest_id).toBe(cancelledManifest);
        await expect(database.exec(`
            INSERT INTO permanent_transfer_events (
              manifest_id, event_type, event_at, reference_number, counterparty,
              document_uri, document_sha256, evidence_attachment_id,
              evidence_verified_at, actor_id
            ) VALUES (
              '${manifest}', 'acknowledgement', '2026-08-21T00:00:00Z', 'ACK-001',
              'Unit Kearsipan', 'attachment:${attachment}', '${hash}', '${attachment}', now(), '${reviewer}'
            )
        `)).rejects.toThrow(/must follow handover/i);
        await database.exec(`
            INSERT INTO permanent_transfer_events (
              manifest_id, event_type, event_at, reference_number, counterparty,
              document_uri, document_sha256, evidence_attachment_id,
              evidence_verified_at, actor_id
            ) VALUES
              ('${manifest}', 'handover', '2026-08-20T00:00:00Z', 'BAST-001',
               'Unit Kearsipan', 'attachment:${attachment}', '${hash}', '${attachment}', now(), '${assessor}'),
              ('${manifest}', 'acknowledgement', '2026-08-21T00:00:00Z', 'ACK-001',
               'Unit Kearsipan', 'attachment:${attachment}', '${hash}', '${attachment}', now(), '${reviewer}');
        `);

        const result = await database.query<{ event_type: string }>(`
            SELECT event_type FROM permanent_transfer_events
            WHERE manifest_id = '${manifest}' ORDER BY event_at
        `);
        expect(result.rows.map((row) => row.event_type)).toEqual(['handover', 'acknowledgement']);
        const finalized = await database.query<{ disposal_status: string; disposal_batch_id: string }>(`
            SELECT disposal_status, disposal_batch_id FROM arsip WHERE id = '${archive}'
        `);
        expect(finalized.rows[0]).toEqual({ disposal_status: 'executed', disposal_batch_id: manifest });
    }, 30_000);
});
