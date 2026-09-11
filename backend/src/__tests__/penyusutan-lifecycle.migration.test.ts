import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

const databases: PGlite[] = [];
afterEach(async () => { await Promise.all(databases.splice(0).map(db => db.close())); });
async function fixture() {
    const db = new PGlite(); databases.push(db);
    await db.exec(`CREATE TABLE penyusutan_arsip(id uuid PRIMARY KEY, status text, jenis_penyusutan text);
        CREATE TABLE arsip(id uuid PRIMARY KEY, disposal_status text, disposal_batch_id uuid);
        CREATE TABLE file_attachments(id uuid PRIMARY KEY, sha256 text, file_url text, drive_file_id text,
            object_generation text, entity_type text, entity_id uuid, integrity_status text,
            size_bytes bigint, storage_access text, file_name text, mime_type text);
        INSERT INTO penyusutan_arsip VALUES ('00000000-0000-4000-8000-000000000001', 'executed', 'pemindahan');
        INSERT INTO arsip VALUES ('00000000-0000-4000-8000-000000000002', 'executed', '00000000-0000-4000-8000-000000000001');`);
    await db.exec(readFileSync(new URL('../db/migrations/0035_disposition_lifecycle_evidence.sql', import.meta.url), 'utf8'));
    return db;
}
describe('disposition lifecycle migration', () => {
    it('preserves historical transfer state until an authorized review, with paired provenance fields', async () => {
        const db = await fixture();
        const { rows } = await db.query('SELECT disposal_status, inactive_transferred_at FROM arsip');
        expect(rows).toEqual([{ disposal_status: 'executed', inactive_transferred_at: null }]);
        await expect(db.exec("UPDATE arsip SET inactive_transferred_at = now()")).rejects.toThrow(/arsip_inactive_transfer_pair_check/);
    }, 30_000);
    it('blocks SQL completion without evidence and rewriting completed evidence', async () => {
        const db = await fixture();
        await db.exec("INSERT INTO penyusutan_arsip VALUES ('00000000-0000-4000-8000-000000000003', 'approved', 'pemusnahan', NULL, NULL)");
        await expect(db.exec("UPDATE penyusutan_arsip SET execution_evidence = '{}' WHERE jenis_penyusutan = 'pemusnahan'"))
            .rejects.toThrow(/penyusutan_execution_evidence_pair_check/);
        await expect(db.exec("UPDATE penyusutan_arsip SET status = 'executed' WHERE jenis_penyusutan = 'pemusnahan'"))
            .rejects.toThrow(/controlled execution evidence/);
        await db.query(`UPDATE penyusutan_arsip SET status = 'executed', execution_evidence = $1, execution_evidence_sha256 = $2
            WHERE jenis_penyusutan = 'pemusnahan'`, [JSON.stringify({ schemaVersion: 1, documents: {}, witnesses: [{}, {}] }), 'a'.repeat(64)]);
        await expect(db.exec("UPDATE penyusutan_arsip SET execution_evidence = '{}' WHERE jenis_penyusutan = 'pemusnahan'"))
            .rejects.toThrow(/immutable/);
        await expect(db.exec("UPDATE penyusutan_arsip SET status = 'approved' WHERE jenis_penyusutan = 'pemusnahan'"))
            .rejects.toThrow(/immutable/);
        await expect(db.exec("DELETE FROM penyusutan_arsip WHERE jenis_penyusutan = 'pemusnahan'"))
            .rejects.toThrow(/immutable/);
    }, 30_000);
    it('protects stored evidence from deletion or replacement while allowing a fixity failure to be recorded', async () => {
        const db = await fixture();
        const id = '00000000-0000-4000-8000-000000000004';
        await db.query(`INSERT INTO file_attachments(id, sha256, file_url, integrity_status) VALUES ($1, $2, 'private/bukti.pdf', 'verified')`, [id, 'a'.repeat(64)]);
        await db.query(`INSERT INTO penyusutan_arsip VALUES ('00000000-0000-4000-8000-000000000005', 'executed', 'pemusnahan', $1, $2)`,
            [JSON.stringify({ schemaVersion: 1, documents: { beritaAcara: { attachmentId: id } }, witnesses: [{}, {}] }), 'b'.repeat(64)]);
        await expect(db.query('DELETE FROM file_attachments WHERE id = $1', [id])).rejects.toThrow(/evidence attachment is immutable/);
        await expect(db.query("UPDATE file_attachments SET file_url = 'replaced' WHERE id = $1", [id])).rejects.toThrow(/evidence attachment is immutable/);
        await expect(db.query("UPDATE file_attachments SET size_bytes = 42 WHERE id = $1", [id])).rejects.toThrow(/evidence attachment is immutable/);
        await expect(db.query("UPDATE file_attachments SET storage_access = 'public' WHERE id = $1", [id])).rejects.toThrow(/evidence attachment is immutable/);
        await db.query("UPDATE file_attachments SET integrity_status = 'mismatch' WHERE id = $1", [id]);
        expect((await db.query('SELECT integrity_status FROM file_attachments')).rows).toEqual([{ integrity_status: 'mismatch' }]);
    }, 30_000);
    it('lets a restricted worker promote an unrelated object without access to the disposition register', async () => {
        const db = await fixture();
        await db.exec(`CREATE ROLE disposition_test_worker;
            GRANT SELECT, UPDATE ON file_attachments TO disposition_test_worker;
            INSERT INTO file_attachments(id, file_url) VALUES ('00000000-0000-4000-8000-000000000006', 'quarantine/file.pdf');
            SET ROLE disposition_test_worker;
            UPDATE file_attachments SET file_url = 'final/file.pdf';
            RESET ROLE;`);
        expect((await db.query('SELECT file_url FROM file_attachments')).rows).toEqual([{ file_url: 'final/file.pdf' }]);
    }, 30_000);
});
