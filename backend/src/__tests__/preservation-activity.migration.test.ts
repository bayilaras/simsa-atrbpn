import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
const ids = Array.from({ length: 4 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE ROLE simsa_api_runtime; CREATE ROLE preservation_worker;
        CREATE TABLE file_attachments(id uuid PRIMARY KEY, sha256 text, file_url text, drive_file_id text,
            object_generation text, size_bytes bigint, storage_access text, file_name text, mime_type text,
            entity_type text, entity_id uuid, integrity_status text, uploaded_by uuid);
        CREATE TABLE preservasi_track(id serial PRIMARY KEY, action text, details text);
        GRANT ALL ON preservasi_track TO simsa_api_runtime;
        INSERT INTO preservasi_track(action, details) VALUES ('conversion', 'Historic free text: completed');`);
    await db.exec(readFileSync(new URL('../db/migrations/0037_preservation_activity_evidence.sql', import.meta.url), 'utf8'));
    for (const id of ids) await db.query("INSERT INTO file_attachments(id, sha256, file_url) VALUES ($1, $2, 'private/file.pdf')", [id, 'a'.repeat(64)]);
}, 30_000);
afterAll(async () => { await db?.close(); });
describe('preservation evidence migration', () => {
    it('keeps prior free text unverified and denies runtime rewriting or deleting history', async () => {
        expect((await db.query('SELECT recording_mode, evidence_snapshot FROM preservasi_track WHERE id = 1')).rows)
            .toEqual([{ recording_mode: 'legacy_unverified', evidence_snapshot: null }]);
        await db.exec('SET ROLE simsa_api_runtime');
        await expect(db.exec("UPDATE preservasi_track SET details = 'trusted' WHERE id = 1")).rejects.toThrow(/permission denied/);
        await expect(db.exec('DELETE FROM preservasi_track WHERE id = 1')).rejects.toThrow(/permission denied/);
        await db.exec('RESET ROLE');
        await expect(db.exec("UPDATE preservasi_track SET details = 'trusted' WHERE id = 1")).rejects.toThrow(/append-only/);
    });
    it('requires a complete snapshot/hash and prevents removing or replacing referenced output', async () => {
        await expect(db.query(`INSERT INTO preservasi_track(action, recording_mode, source_attachment_id, evidence_snapshot)
            VALUES ('integrity_check', 'system_integrity_check', $1, '{}')`, [ids[0]])).rejects.toThrow(/preservation_activity_evidence_check/);
        await db.query(`INSERT INTO preservasi_track(action, recording_mode, source_attachment_id, output_attachment_id,
            evidence_attachment_id, evidence_snapshot, evidence_snapshot_sha256) VALUES ('conversion', 'external_activity_recorded', $1, $2, $3, '{}', $4)`,
            [ids[0], ids[1], ids[2], 'b'.repeat(64)]);
        await expect(db.query('DELETE FROM file_attachments WHERE id = $1', [ids[1]])).rejects.toThrow(/foreign key/);
        await expect(db.query("UPDATE file_attachments SET sha256 = $2 WHERE id = $1", [ids[1], 'c'.repeat(64)])).rejects.toThrow(/evidence attachment is immutable/);
    });
    it('allows worker fixity status updates and unrelated promotions without access to activity history', async () => {
        await db.exec('GRANT SELECT, UPDATE ON file_attachments TO preservation_worker; SET ROLE preservation_worker;');
        await db.query("UPDATE file_attachments SET integrity_status = 'mismatch' WHERE id = $1", [ids[0]]);
        await db.query("UPDATE file_attachments SET file_url = 'final/new.pdf' WHERE id = $1", [ids[3]]);
        await db.exec('RESET ROLE');
        expect((await db.query('SELECT integrity_status FROM file_attachments WHERE id = $1', [ids[0]])).rows).toEqual([{ integrity_status: 'mismatch' }]);
    });
});
