import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { drizzle } from 'drizzle-orm/pglite';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { enterTestMigratorRole } from './helpers/database-role-fixture';

const holder = vi.hoisted(() => ({ db: null as any, download: vi.fn(), upload: vi.fn() }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));
vi.mock('../services/blob-storage.service', () => ({ blobStorageService: { downloadFile: holder.download, uploadUntrustedFile: holder.upload } }));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => { req.user = { id: '10000000-0000-4000-8000-000000000001', email: 'stale@example.test', role: 'admin_dirjen', unitKerjaId: 'ditjen' }; next(); } }));
vi.mock('../middlewares/rate-limiter.middleware', () => ({ uploadLimiter: (_req: any, _res: any, next: any) => next() }));
let database: PGlite;
let service: typeof import('../services/arsip-attachment-upload.service').arsipAttachmentUploadService;
let audit: typeof import('../services/audit-log.service').default;
let app: express.Express;
const userId = '10000000-0000-4000-8000-000000000001';
const otherUserId = '10000000-0000-4000-8000-000000000002';
const archiveId = '20000000-0000-4000-8000-000000000001';
const otherArchiveId = '20000000-0000-4000-8000-000000000002';
const pathname = `arsip-attachments/${archiveId}/bukti-random.pdf`;
const blobUrl = `https://store.private.blob.vercel-storage.com/${pathname}`;
const payload = { blobUrl, fileName: 'bukti.pdf' };
const submit = () => service.finalize(archiveId, payload, { userId, userEmail: 'stale@example.test' });
const pdf = Buffer.from('%PDF-1.7\ncontrolled bytes for quarantine only\n%%EOF');

beforeAll(async () => {
    // Import before database work: a missing implementation is a fast, clear RED.
    ({ arsipAttachmentUploadService: service } = await import('../services/arsip-attachment-upload.service'));
    database = new PGlite({ extensions: { pgcrypto } });
    await database.waitReady;
    await enterTestMigratorRole(database);
    const dir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
    for (const file of readdirSync(dir).filter(file => /^\d{4}.*\.sql$/.test(file) && Number(file.slice(0, 4)) <= 38).sort()) {
        for (const statement of readFileSync(`${dir}/${file}`, 'utf8').split('--> statement-breakpoint').filter(value => value.trim())) await database.exec(statement);
    }
    holder.db = drizzle(database, { schema });
    // The database mock exposes a getter so services use this initialized handle.
    ({ default: audit } = await import('../services/audit-log.service'));
    app = express(); app.use(express.json());
    app.use('/api/upload', (await import('../routes/upload.routes')).default);
}, 45_000);
afterAll(async () => { await database?.close(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); });
beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-11T00:00:00Z'));
    vi.stubEnv('OBJECT_STORAGE_PROVIDER', 'vercel-blob');
    holder.upload.mockReset().mockResolvedValue({ url: 'https://store.private.blob.vercel-storage.com/server-created.pdf' });
    holder.download.mockReset().mockImplementation(async () => ({ stream: Readable.from([pdf]), mimeType: 'application/pdf' }));
    await database.exec(`TRUNCATE client_blob_uploads, file_attachments, arsip, users, unit_kerja CASCADE;
        INSERT INTO unit_kerja(id,name) VALUES ('ditjen','Ditjen'),('sesditjen','Sesditjen');
        INSERT INTO users(id,email,role,unit_kerja_id) VALUES ('${userId}','current@example.test','admin_dirjen','ditjen'),('${otherUserId}','other@example.test','admin_dirjen','ditjen');
        INSERT INTO arsip(id,unit_kerja_id,jenis_arsip,tahun,klasifikasi_keamanan) VALUES ('${archiveId}','ditjen','masuk',2026,'biasa'),('${otherArchiveId}','ditjen','masuk',2026,'biasa');
        INSERT INTO client_blob_uploads(blob_url,pathname,purpose,uploaded_by,expires_at) VALUES ('${blobUrl}','${pathname}','arsip','${userId}','2026-09-12T00:00:00Z');`);
});
async function grant() {
    await database.exec(`UPDATE arsip SET klasifikasi_keamanan='terbatas' WHERE id='${archiveId}';
        INSERT INTO record_access_grants(requester_id,target_user_id,entity_type,entity_id,unit_kerja_id,required_classification,purpose,access_mode,status,decided_by,decided_at,decision_reason,expires_at)
        VALUES ('${userId}','${userId}','arsip','${archiveId}','ditjen','terbatas','Registrasi lampiran arsip untuk pekerjaan resmi','manage','approved','${userId}','2026-09-10T00:00:00Z','Kebutuhan pekerjaan terverifikasi','2026-09-11T01:00:00Z');`);
}
async function unchanged() {
    expect((await database.query('SELECT id FROM file_attachments')).rows).toHaveLength(0);
    expect((await database.query('SELECT id FROM audit_log')).rows).toHaveLength(0);
    expect((await database.query<any>('SELECT status FROM client_blob_uploads')).rows.every(row => row.status === 'pending')).toBe(true);
}
describe('durable direct upload registration for an existing archive', () => {
    it('rejects the legacy multipart bypass on Vercel before storage I/O', async () => {
        const result = await request(app).post(`/api/upload/arsip/${archiveId}`).attach('file', pdf, { filename: 'bukti.pdf', contentType: 'application/pdf' });
        expect(result.status).toBe(400); expect(result.body.code).toBe('DIRECT_ARCHIVE_UPLOAD_REQUIRED');
        expect(result.body.error).toMatch(/unggah langsung/i);
        expect(holder.upload).not.toHaveBeenCalled(); await unchanged();
    });
    it('keeps the existing GCS multipart route available', async () => {
        vi.stubEnv('OBJECT_STORAGE_PROVIDER', 'gcs');
        holder.upload.mockResolvedValueOnce({ url: 'gs://test-private-upload/server-created.pdf', generation: '1234' });
        const result = await request(app).post(`/api/upload/arsip/${archiveId}`).attach('file', pdf, { filename: 'bukti.pdf', contentType: 'application/pdf' });
        expect(result.status).toBe(201); expect(holder.upload).toHaveBeenCalledOnce();
    });
    it('returns authorized JSON registration and replay with safe attachment URLs', async () => {
        const first = await request(app).post(`/api/upload/arsip/${archiveId}`).send(payload).expect(201);
        expect(first.body.data).toMatchObject({ accessUrl: expect.stringContaining('/api/files/attachment/'), malwareScanStatus: 'not_scanned', sizeBytes: pdf.length });
        expect(first.body.data).not.toHaveProperty('fileUrl'); expect(first.body.data).not.toHaveProperty('driveFileId');
        const replay = await request(app).post(`/api/upload/arsip/${archiveId}`).send(payload).expect(200);
        expect(replay.body.data.id).toBe(first.body.data.id); expect(replay.body.reused).toBe(true);
    });
    it('rejects client-assigned scan fields before storage or database mutation', async () => {
        await request(app).post(`/api/upload/arsip/${archiveId}`).send({ ...payload, malwareScanStatus: 'clean' }).expect(400);
        expect(holder.download).not.toHaveBeenCalled(); await unchanged();
    });
    it('exposes only the bounded callback-pending retry code on the upload endpoint', async () => {
        await database.exec('DELETE FROM client_blob_uploads');
        const response = await request(app).post(`/api/upload/arsip/${archiveId}`).send(payload).expect(409);
        expect(response.body.code).toBe('UPLOAD_COMPLETION_PENDING'); await unchanged();
    });
    it('accepts exactly 10 MiB, seals a quarantined attachment and retries without a second read or audit', async () => {
        const bytes = Buffer.alloc(10 * 1024 * 1024); pdf.copy(bytes);
        holder.download.mockResolvedValueOnce({ stream: Readable.from([bytes]), mimeType: 'application/pdf' });
        const first = await submit();
        expect(first.attachment).toMatchObject({ entityId: archiveId, entityType: 'arsip', sizeBytes: bytes.length, storageAccess: 'private', malwareScanStatus: 'not_scanned', integrityStatus: 'baseline_recorded' });
        expect(first.reused).toBe(false);
        const second = await submit();
        expect(second.reused).toBe(true); expect(second.attachment.id).toBe(first.attachment.id);
        expect(holder.download).toHaveBeenCalledTimes(1);
        expect((await database.query('SELECT id FROM file_attachments')).rows).toHaveLength(1);
        expect((await database.query<any>('SELECT user_email FROM audit_log')).rows).toEqual([{ user_email: 'current@example.test' }]);
        expect((await database.query<any>('SELECT status,claimed_entity_type,claimed_entity_id FROM client_blob_uploads')).rows).toEqual([{ status: 'claimed', claimed_entity_type: 'arsip', claimed_entity_id: archiveId }]);
    });
    it('returns a retryable pending status before the signed callback without reading storage', async () => {
        await database.exec('DELETE FROM client_blob_uploads');
        await expect(submit()).rejects.toMatchObject({ statusCode: 409, code: 'UPLOAD_COMPLETION_PENDING' });
        expect(holder.download).not.toHaveBeenCalled(); await unchanged();
    });
    it.each(['other-uploader', 'wrong-purpose', 'expired', 'wrong-target'])('rejects %s before storage I/O', async state => {
        if (state === 'other-uploader') await database.exec(`UPDATE client_blob_uploads SET uploaded_by='${otherUserId}'`);
        if (state === 'wrong-purpose') await database.exec("UPDATE client_blob_uploads SET purpose='surat_masuk'");
        if (state === 'expired') await database.exec("UPDATE client_blob_uploads SET expires_at='2026-09-10T00:00:00Z'");
        const attempt = state === 'wrong-target' ? service.finalize(otherArchiveId, payload, { userId }) : submit();
        await expect(attempt).rejects.toThrow(); expect(holder.download).not.toHaveBeenCalled(); await unchanged();
    });
    it.each(['magic', 'mime', 'oversize'])('rejects actual stored %s and leaves its pending cleanup lease', async state => {
        holder.download.mockResolvedValueOnce({ stream: Readable.from([state === 'magic' ? Buffer.from('not a PDF') : state === 'oversize' ? Buffer.alloc(10 * 1024 * 1024 + 1) : pdf]), mimeType: state === 'mime' ? 'image/png' : 'application/pdf' });
        await expect(submit()).rejects.toThrow(); await unchanged();
    });
    it.each(['inactive', 'staff', 'unit', 'hold', 'grant-revoked', 'grant-expired'])('rechecks %s changed during byte preflight', async state => {
        if (state.startsWith('grant')) await grant();
        holder.download.mockImplementationOnce(async () => {
            if (state === 'inactive') await database.exec('UPDATE users SET is_active=false');
            if (state === 'staff') await database.exec("UPDATE users SET role='staff'");
            if (state === 'unit') await database.exec("UPDATE arsip SET unit_kerja_id='sesditjen'");
            if (state === 'hold') await database.exec("UPDATE arsip SET legal_hold=true,legal_hold_reason='Penahanan untuk pemeriksaan resmi',legal_hold_placed_at=now()");
            if (state === 'grant-revoked') await database.exec(`UPDATE record_access_grants SET status='revoked',revoked_by='${userId}',revoked_at=now(),revocation_reason='Izin kelola telah dicabut'`);
            if (state === 'grant-expired') vi.setSystemTime(new Date('2026-09-11T02:00:00Z'));
            return { stream: Readable.from([pdf]), mimeType: 'application/pdf' };
        });
        await expect(submit()).rejects.toThrow(/izin|akses|aktif|ditahan/i); await unchanged();
    });
    it('rolls back attachment, claim and audit if the manage grant expires before commit', async () => {
        await grant(); const original = audit.logActionOrThrow.bind(audit);
        vi.spyOn(audit, 'logActionOrThrow').mockImplementation(async (...args) => { await original(...args); vi.setSystemTime(new Date('2026-09-11T02:00:00Z')); });
        await expect(submit()).rejects.toThrow(/izin|akses/i); await unchanged();
    });
    it('rolls back the claim and attachment when critical audit fails', async () => {
        vi.spyOn(audit, 'logActionOrThrow').mockRejectedValueOnce(new Error('audit unavailable'));
        await expect(submit()).rejects.toThrow('audit unavailable'); await unchanged();
    });
    it('requires current access even for a previously committed retry', async () => {
        await submit(); await database.exec('UPDATE users SET is_active=false');
        await expect(submit()).rejects.toThrow(/aktif|izin/i);
        expect(holder.download).toHaveBeenCalledTimes(1);
    });
});
