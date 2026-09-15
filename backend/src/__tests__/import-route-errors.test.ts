import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ConflictError, DatabaseError, ValidationError } from '../utils/errors.js';
import { publicErrorResponse, publicErrorStatus } from '../utils/public-error.js';

const mocks = vi.hoisted(() => ({
    sheets: vi.fn(), preview: vi.fn(), incoming: vi.fn(), outgoing: vi.fn(),
    attachments: vi.fn(), ingest: vi.fn(), finalize: vi.fn(), update: vi.fn(), verify: vi.fn(), remove: vi.fn(), preservation: vi.fn(),
    access: { exists: true, allowed: true, mutable: true },
    user: { id: '11111111-1111-4111-8111-111111111111', role: 'super_admin', email: 'synthetic@example.test', unitKerjaId: 'ditjen' },
}));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => { req.user = mocks.user; next(); } }));
vi.mock('../middlewares/role.middleware', () => ({ canWriteMiddleware: () => (_req: any, _res: any, next: any) => next(), permissionMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../middlewares/rate-limiter.middleware', () => ({ importDiscoveryLimiter: (_req: any, _res: any, next: any) => next(), importPreviewLimiter: (_req: any, _res: any, next: any) => next(), importLimiter: (_req: any, _res: any, next: any) => next(), uploadLimiter: (_req: any, _res: any, next: any) => next(), sensitiveLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/google-drive-import.service', () => ({ googleDriveImportService: {
    extractSpreadsheetId: (url: string) => /^https:\/\/docs\.google\.com\/spreadsheets\/d\/test-sheet(?:\/|$)/.test(url) ? 'test-sheet' : null,
    listSheets: mocks.sheets, previewData: mocks.preview, importSuratMasuk: mocks.incoming, importSuratKeluar: mocks.outgoing,
} }));
vi.mock('../services/file-attachment.service', () => ({ fileAttachmentService: { findBySurat: mocks.attachments } }));
vi.mock('../services/arsip-attachment-upload.service.js', () => ({ arsipAttachmentUploadService: { finalize: mocks.finalize } }));
vi.mock('../services/malware-scan-dispatch.service.js', () => ({ scheduleMalwareScanWake: vi.fn(() => true) }));
vi.mock('../services/record-access.service', () => ({ recordAccessService: { check: async () => mocks.access }, allowedSecurityClassifications: () => ['biasa'] }));
vi.mock('../services/arsip-elektronik.service.js', () => ({ arsipElektronikService: {
    findById: async () => ({ arsipId: '22222222-2222-4222-8222-222222222222' }),
    create: mocks.ingest, update: mocks.update, verify: mocks.verify, delete: mocks.remove, addPreservationAction: mocks.preservation,
} }));
vi.mock('../services/preservation-activity.service.js', () => ({ preservationAttachmentOptions: vi.fn() }));

import importRoutes, { withGoogleSheetsRequest } from '../routes/google-drive-import.routes';
import uploadRoutes from '../routes/upload.routes';
import electronicRoutes from '../routes/arsip-elektronik.routes';

const id = '22222222-2222-4222-8222-222222222222';
const url = 'https://docs.google.com/spreadsheets/d/test-sheet/edit';
const marker = 'SYNTHETIC_SECRET_DATABASE_TOKEN';
const app = express();
app.use(express.json());
app.use((_req, res, next) => { res.locals.requestId = 'synthetic-request'; next(); });
app.use('/api/import', importRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/electronic', electronicRoutes);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(publicErrorStatus(error)).json(publicErrorResponse(error, res.locals.requestId));
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.access = { exists: true, allowed: true, mutable: true };
    for (const mock of [mocks.sheets, mocks.preview, mocks.incoming, mocks.outgoing, mocks.attachments, mocks.ingest, mocks.finalize, mocks.update, mocks.verify, mocks.remove, mocks.preservation]) {
        mock.mockReset().mockRejectedValue(new Error(marker));
    }
});

describe('HTTP error boundaries for import, attachments and electronic archives', () => {
    it.each(['sheets', 'preview', 'surat-masuk', 'surat-keluar'])('sanitizes %s provider faults with a stable code and request ID', async path => {
        const response = path === 'sheets'
            ? await request(app).get(`/api/import/google-drive/${path}`).query({ url })
            : await request(app).post(`/api/import/google-drive/${path}`).send(path === 'preview' ? { spreadsheetUrl: url } : { spreadsheetUrl: url, unitKerjaId: 'ditjen' });
        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR', requestId: 'synthetic-request' });
        expect(response.text).not.toContain(marker);
    });
    it('does not treat an operational DatabaseError as a public message', async () => {
        mocks.preview.mockRejectedValue(new DatabaseError(marker));
        const response = await request(app).post('/api/import/google-drive/preview').send({ spreadsheetUrl: url });
        expect(response.status).toBe(500);
        expect(response.text).not.toContain(marker);
    });
    it.each([0, -1, 101, 1.5, '1000', null, {}, []])('rejects maxRows %s before invoking the source', async maxRows => {
        const response = await request(app).post('/api/import/google-drive/preview').send({ spreadsheetUrl: url, maxRows });
        expect(response.status).toBe(400);
        expect(mocks.preview).not.toHaveBeenCalled();
    });
    it('preserves a useful typed input error and unit validation', async () => {
        mocks.preview.mockRejectedValue(new ValidationError('Pilih sheet yang tersedia untuk akses publik.'));
        const response = await request(app).post('/api/import/google-drive/preview').send({ spreadsheetUrl: url });
        expect(response.status).toBe(400);
        expect(response.body.message).toContain('Pilih sheet');
        const unit = await request(app).post('/api/import/google-drive/surat-masuk').send({ spreadsheetUrl: url });
        expect(unit.status).toBe(400);
        expect(mocks.incoming).not.toHaveBeenCalled();
    });
    it('sanitizes attachment listing errors and retains access denial', async () => {
        const response = await request(app).get(`/api/upload/arsip/${id}`);
        expect(response.status).toBe(500);
        expect(response.text).not.toContain(marker);
        mocks.access.allowed = false;
        expect((await request(app).get(`/api/upload/arsip/${id}`)).status).toBe(404);
    });
    it.each(['create', 'update', 'verify', 'delete', 'preservasi'])('sanitizes electronic %s failures', async action => {
        const response = action === 'create' ? await request(app).post('/api/electronic').send({ arsipId: id, fileAttachmentId: id })
            : action === 'update' ? await request(app).put(`/api/electronic/${id}`).send({ mediaAsal: 'kertas' })
            : action === 'delete' ? await request(app).delete(`/api/electronic/${id}`)
            : await request(app).post(`/api/electronic/${id}/${action}`).send(action === 'verify' ? { status: 'verified' } : { action: 'integrity_check', details: 'Pemeriksaan integritas rutin' });
        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR', requestId: 'synthetic-request' });
        expect(response.text).not.toContain(marker);
    });
    it('preserves explicit electronic workflow conflicts', async () => {
        mocks.update.mockRejectedValue(new ConflictError('Metadata versi terverifikasi bersifat immutable.'));
        const response = await request(app).put(`/api/electronic/${id}`).send({ mediaAsal: 'kertas' });
        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({ code: 'CONFLICT', message: 'Metadata versi terverifikasi bersifat immutable.' });
    });
    it('aborts downstream work on disconnect and removes listeners', async () => {
        const req = Object.assign(new EventEmitter(), { aborted: false });
        const res = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false });
        let signal: AbortSignal | undefined;
        let finish: () => void = () => {};
        const work = withGoogleSheetsRequest(req as any, res as any, async options => {
            signal = options.signal; await new Promise<void>(resolve => { finish = resolve; });
        });
        res.emit('close');
        expect(signal?.aborted).toBe(true);
        finish(); await work;
        expect(req.listenerCount('aborted')).toBe(0);
        expect(res.listenerCount('close')).toBe(0);
    });
});
