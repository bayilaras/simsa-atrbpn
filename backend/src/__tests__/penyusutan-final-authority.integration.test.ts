import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { enterTestMigratorRole } from './helpers/database-role-fixture';
import { hashEvidenceSnapshot } from '../utils/evidence-hash';

const holder = vi.hoisted(() => ({ db: null as any }));
const storage = vi.hoisted(() => ({ downloadFile: vi.fn() }));
vi.mock('../config/database', () => ({ db: holder.db }));
vi.mock('../services/blob-storage.service', () => ({ blobStorageService: storage }));
let database: PGlite;
let service: typeof import('../services/penyusutan.service').penyusutanService;
let files: typeof import('../services/file-attachment.service').fileAttachmentService;
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { id: id(1), role: 'super_admin', email: 'executor@example.test', unitKerjaId: 'ditjen' };
const archiveId = id(10), batchId = id(20);
const bytes = Buffer.from('controlled destruction evidence');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const input = { beritaAcaraAttachmentId: id(30), decisionAttachmentId: id(31), executionProofAttachmentId: id(32),
    performedAt: '2026-09-02T08:00:00+07:00', method: 'Pencacahan dengan pengawasan petugas',
    copiesStatement: 'Seluruh salinan diperiksa sesuai dokumen bukti pelaksanaan.',
    witnesses: [{ userId: id(2), authorityAttachmentId: id(33) }, { userId: id(3), authorityAttachmentId: id(33) }] };
const execute = () => service.updateStatus(batchId, { user: actor, executionEvidence: input }, null);
beforeAll(async () => {
    database = new PGlite({ extensions: { pgcrypto } }); await database.waitReady;
    await enterTestMigratorRole(database);
    const dir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
    for (const file of readdirSync(dir).filter(file => /^\d{4}.*\.sql$/.test(file) && Number(file.slice(0, 4)) <= 35 && !file.startsWith('0034_')).sort()) {
        for (const sql of readFileSync(`${dir}/${file}`, 'utf8').split('--> statement-breakpoint').filter(sql => sql.trim())) await database.exec(sql);
    }
    holder.db = drizzle(database, { schema });
    ({ penyusutanService: service } = await import('../services/penyusutan.service'));
    ({ fileAttachmentService: files } = await import('../services/file-attachment.service'));
    // Retention provenance has separate suites. This test exercises actual DB authority,
    // storage byte verification, evidence JSONB and finalization under parent row locks.
    vi.spyOn(service as any, 'assertBatchRetentionEligible').mockImplementation(async (tx: any) => tx.select().from(schema.arsip).for('update'));
}, 45_000);
afterAll(async () => { vi.restoreAllMocks(); await database?.close(); });
beforeEach(async () => {
    await database.exec(`TRUNCATE arsip,users,unit_kerja,penyusutan_arsip,audit_log CASCADE;
      INSERT INTO unit_kerja(id,name) VALUES ('ditjen','Ditjen'),('other','Other');
      INSERT INTO users(id,email,name,role,unit_kerja_id) VALUES
        ('${id(1)}','executor@example.test','Pelaksana','super_admin',NULL),
        ('${id(2)}','witness2@example.test','Saksi 2','staff','ditjen'),
        ('${id(3)}','witness3@example.test','Saksi 3','staff','ditjen');
      INSERT INTO penyusutan_arsip(id,unit_kerja_id,jenis_penyusutan,status,tanggal_persetujuan)
        VALUES ('${batchId}','ditjen','pemusnahan','approved','2026-09-01');
      INSERT INTO arsip(id,unit_kerja_id,jenis_arsip,tahun,klasifikasi_keamanan,disposal_status,disposal_batch_id)
        VALUES ('${archiveId}','ditjen','masuk',2026,'biasa','approved','${batchId}');
      INSERT INTO penyusutan_items(penyusutan_id,arsip_id) VALUES ('${batchId}','${archiveId}');`);
    for (const n of [30,31,32,33]) await database.query(`INSERT INTO file_attachments
      (id,entity_type,entity_id,file_name,file_url,sha256,size_bytes,storage_access,integrity_status,malware_scan_status,last_fixity_check_at)
      VALUES ($1,'arsip',$2,$3,$4,$5,$6,'private','verified','clean','2026-09-01')`,
      [id(n),archiveId,`bukti-${n}.pdf`,`https://test.private.blob.vercel-storage.com/${n}.pdf`,sha256,bytes.length]);
    storage.downloadFile.mockReset(); storage.downloadFile.mockImplementation(async () => ({ stream: Readable.from([bytes]) }));
});

describe('disposition final authority and stored bytes', () => {
    it('rechecks every unique proof and hashes the persisted JSONB consistently', async () => {
        await execute();
        expect(storage.downloadFile).toHaveBeenCalledTimes(4);
        const row = (await database.query<any>('SELECT status,execution_evidence,execution_evidence_sha256 FROM penyusutan_arsip')).rows[0];
        expect(row.status).toBe('executed');
        expect(hashEvidenceSnapshot(row.execution_evidence)).toBe(row.execution_evidence_sha256);
    });
    it('rejects changed bytes and durably quarantines the proof without finalizing', async () => {
        storage.downloadFile.mockImplementation(async () => ({ stream: Readable.from([Buffer.alloc(bytes.length, 120)]) }));
        await expect(execute()).rejects.toThrow(/bukti|integritas/i);
        expect((await database.query<any>('SELECT status,execution_evidence FROM penyusutan_arsip')).rows[0]).toEqual({ status: 'approved', execution_evidence: null });
        expect((await database.query<any>("SELECT count(*)::int n FROM file_attachments WHERE integrity_status='mismatch'")).rows[0].n).toBeGreaterThan(0);
        expect((await database.query<any>("SELECT count(*)::int n FROM audit_log WHERE changes->>'operation'='execution_evidence_rejected'")).rows[0].n).toBe(1);
    });
    it('rejects unavailable storage without a false successful check', async () => {
        storage.downloadFile.mockRejectedValue(new Error('Storage unavailable'));
        await expect(execute()).rejects.toThrow();
        expect((await database.query<any>('SELECT status FROM penyusutan_arsip')).rows[0].status).toBe('approved');
    });
    it('rechecks grant expiry after reading bytes, before finalizing', async () => {
        await database.exec(`UPDATE arsip SET klasifikasi_keamanan='rahasia';
          INSERT INTO record_access_grants(requester_id,target_user_id,entity_type,entity_id,unit_kerja_id,required_classification,purpose,access_mode,status,decided_by,decided_at,decision_reason,expires_at)
          VALUES ('${id(1)}','${id(1)}','arsip','${archiveId}','ditjen','rahasia','Pencatatan pelaksanaan dengan bukti terkendali','manage','approved','${id(2)}','2026-09-10','Izin pengelolaan khusus','2026-09-11T12:01:00Z');`);
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
        storage.downloadFile.mockImplementationOnce(async () => {
            vi.setSystemTime(new Date('2026-09-11T12:02:00Z'));
            return { stream: Readable.from([bytes]) };
        });
        try {
            await expect(execute()).rejects.toThrow(/Akses kelola/);
            expect(storage.downloadFile).toHaveBeenCalledTimes(4);
            expect((await database.query<any>('SELECT status FROM penyusutan_arsip')).rows[0].status).toBe('approved');
        } finally { vi.useRealTimers(); }
    });
    it.each(['finalization', 'rejection'])('requires a durable audit for %s without partial state', async operation => {
        if (operation === 'rejection') storage.downloadFile.mockImplementation(async () => ({ stream: Readable.from([Buffer.alloc(bytes.length, 120)]) }));
        await database.exec(`CREATE FUNCTION reject_disposition_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$;
          CREATE TRIGGER reject_disposition_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_disposition_audit();`);
        try {
            await expect(execute()).rejects.toMatchObject({ cause: { message: 'audit unavailable' } });
            expect((await database.query<any>('SELECT status,execution_evidence FROM penyusutan_arsip')).rows[0]).toEqual({ status: 'approved', execution_evidence: null });
            expect((await database.query<any>("SELECT count(*)::int n FROM file_attachments WHERE integrity_status='mismatch'")).rows[0].n).toBe(0);
        } finally { await database.exec('DROP TRIGGER reject_disposition_audit ON audit_log; DROP FUNCTION reject_disposition_audit();'); }
    });
    it.each(['inactive', 'demoted', 'wrong_unit', 'no_grant'])('rejects finalization with %s authority despite the stale request actor', async mode => {
        if (mode === 'inactive') await database.query('UPDATE users SET is_active=false WHERE id=$1', [actor.id]);
        if (mode === 'demoted') await database.query("UPDATE users SET role='staff',unit_kerja_id='ditjen' WHERE id=$1", [actor.id]);
        if (mode === 'wrong_unit') await database.query("UPDATE users SET role='staff',unit_kerja_id='other' WHERE id=$1", [actor.id]);
        if (mode === 'no_grant') await database.exec("UPDATE arsip SET klasifikasi_keamanan='rahasia'");
        await expect(execute()).rejects.toThrow();
        expect(storage.downloadFile).not.toHaveBeenCalled();
        expect((await database.query<any>('SELECT status FROM penyusutan_arsip')).rows[0].status).toBe('approved');
    });
    it('rejects upload by a revoked actor before creating an object', async () => {
        await database.query('UPDATE users SET is_active=false WHERE id=$1', [actor.id]);
        const create = vi.spyOn(files, 'create').mockResolvedValueOnce({ id: id(50) } as any);
        try {
            await expect(service.uploadExecutionEvidence(batchId, archiveId, { originalname: 'proof.pdf', mimetype: 'application/pdf', buffer: bytes }, actor, null)).rejects.toThrow();
            expect(create).not.toHaveBeenCalled();
        } finally { create.mockRestore(); }
    });
    it('rejects a read-only staff member at the first workflow transition', async () => {
        await database.exec(`UPDATE penyusutan_arsip SET status='draft'; UPDATE users SET role='staff',unit_kerja_id='ditjen' WHERE id='${actor.id}';`);
        await expect(service.updateStatus(batchId, { user: actor }, 'ditjen')).rejects.toThrow();
        expect((await database.query<any>('SELECT status FROM penyusutan_arsip')).rows[0].status).toBe('draft');
    });
    it('rejects recovery by a revoked actor', async () => {
        await database.exec(`UPDATE penyusutan_arsip SET jenis_penyusutan='pemindahan',status='executed',executed_by='${id(2)}',tanggal_pelaksanaan='2026-09-02'; UPDATE arsip SET disposal_status='executed';`);
        await database.query('UPDATE users SET is_active=false WHERE id=$1', [actor.id]);
        await expect(service.recoverInactiveTransfer(batchId, 'Peninjauan independen atas pemindahan arsip lama.', actor, null)).rejects.toThrow();
        expect((await database.query<any>('SELECT disposal_status FROM arsip')).rows[0].disposal_status).toBe('executed');
    });
});
