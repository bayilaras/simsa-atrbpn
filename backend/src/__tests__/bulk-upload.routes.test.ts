import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    user: {
        id: 'creator-1',
        email: 'creator@example.test',
        name: 'Creator',
        role: 'admin_dirjen',
        unitKerjaId: 'ditjen' as string | null,
    },
    batch: null as any,
    limits: {
        maxFiles: 50,
        maxFileBytes: 50 * 1024 * 1024,
        maxBatchBytes: 100 * 1024 * 1024,
    },
    service: {
        validateFiles: vi.fn(),
        createBatch: vi.fn(),
        processBatch: vi.fn(),
        cancelBatch: vi.fn(),
        getBatch: vi.fn(),
        getLatestActiveBatch: vi.fn(),
        confirmBatch: vi.fn(),
        cleanupOldBatches: vi.fn(),
    },
}));

const validConfirmation = {
    items: [{
        itemId: '20000000-0000-4000-8000-000000000001',
        nomorBerkas: 'BERKAS-1',
        uraianBerkas: 'Uraian arsip',
        kodeKlasifikasi: 'UM.01',
        tahun: 2026,
        jenisArsip: 'masuk',
    }],
};

vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { ...state.user };
        next();
    },
}));

vi.mock('../middlewares/rate-limiter.middleware.js', () => ({
    uploadLimiter: (_req: any, _res: any, next: any) => next(),
    ocrLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/bulk-upload.service.js', () => ({
    BULK_UPLOAD_LIMITS: state.limits,
    BulkUploadError: class BulkUploadError extends Error {
        statusCode: number;
        activeBatchId?: string;
        retryAfterSeconds?: number;

        constructor(
            message: string,
            statusCode: number = 400,
            activeBatchId?: string,
            retryAfterSeconds?: number,
        ) {
            super(message);
            this.statusCode = statusCode;
            this.activeBatchId = activeBatchId;
            this.retryAfterSeconds = retryAfterSeconds;
        }
    },
    bulkUploadService: state.service,
}));

vi.mock('../utils/logger.js', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { default: bulkUploadRouter } = await import('../routes/bulk-upload.routes.js');
const { BulkUploadError } = await import('../services/bulk-upload.service.js');

const app = express();
app.use(express.json());
app.use('/bulk-upload', bulkUploadRouter);

function pdfUpload(unitKerjaId?: string) {
    let uploadRequest = request(app)
        .post('/bulk-upload')
        .attach('files', Buffer.from('%PDF-1.4 test'), {
            filename: 'record.pdf',
            contentType: 'application/pdf',
        });

    if (unitKerjaId !== undefined) {
        uploadRequest = uploadRequest.field('unitKerjaId', unitKerjaId);
    }

    return uploadRequest;
}

describe('bulk upload authorization boundaries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(state.user, {
            id: 'creator-1',
            email: 'creator@example.test',
            name: 'Creator',
            role: 'admin_dirjen',
            unitKerjaId: 'ditjen',
        });
        state.batch = {
            batchId: '10000000-0000-4000-8000-000000000001',
            unitKerjaId: 'ditjen',
            createdBy: 'creator-1',
            totalFiles: 1,
            processedFiles: 1,
            items: [],
            status: 'completed',
            createdAt: new Date('2026-08-25T00:00:00.000Z'),
        };
        state.service.validateFiles.mockReturnValue({ valid: true, errors: [] });
        state.service.createBatch.mockImplementation((_files, unitKerjaId, createdBy) => ({
            ...state.batch,
            unitKerjaId,
            createdBy,
        }));
        state.service.processBatch.mockResolvedValue(state.batch);
        state.service.cancelBatch.mockResolvedValue({
            batchesExpired: 1,
            blobsDeleted: 1,
            blobsFailed: 0,
            blobsProtected: 0,
        });
        state.limits.maxBatchBytes = 100 * 1024 * 1024;
        state.service.getBatch.mockImplementation(() => state.batch);
        state.service.getLatestActiveBatch.mockImplementation((createdBy, unitKerjaId) => (
            state.batch?.createdBy === createdBy && state.batch?.unitKerjaId === unitKerjaId
                ? state.batch
                : null
        ));
        state.service.confirmBatch.mockResolvedValue({
            created: 1,
            failed: 0,
            arsipIds: ['arsip-1'],
        });
        state.service.cleanupOldBatches.mockResolvedValue(0);
    });

    it.each(['staff', 'auditor'])('blocks %s from creating or confirming a batch', async (role) => {
        Object.assign(state.user, { role, unitKerjaId: 'ditjen' });

        await pdfUpload('ditjen').expect(403);
        await request(app)
            .post('/bulk-upload/10000000-0000-4000-8000-000000000001/confirm')
            .send(validConfirmation)
            .expect(403);

        expect(state.service.createBatch).not.toHaveBeenCalled();
        expect(state.service.confirmBatch).not.toHaveBeenCalled();
    });

    it('rejects a forged create unit and uses the server-resolved unit otherwise', async () => {
        await pdfUpload('sesditjen').expect(403);
        expect(state.service.createBatch).not.toHaveBeenCalled();

        await pdfUpload().expect(200);
        expect(state.service.createBatch).toHaveBeenCalledWith(
            expect.any(Array),
            'ditjen',
            'creator-1',
        );
    });

    it('requires super_admin to choose a concrete upload unit', async () => {
        Object.assign(state.user, { role: 'super_admin', unitKerjaId: null });

        await pdfUpload().expect(400);
        expect(state.service.createBatch).not.toHaveBeenCalled();

        await pdfUpload('unit-khusus').expect(200);
        expect(state.service.createBatch).toHaveBeenCalledWith(
            expect.any(Array),
            'unit-khusus',
            'creator-1',
        );
    });

    it('only returns a batch to its creator inside the authoritative unit', async () => {
        await request(app).get('/bulk-upload/10000000-0000-4000-8000-000000000001').expect(200);
        expect(state.service.processBatch).not.toHaveBeenCalled();

        Object.assign(state.user, { id: 'other-admin' });
        await request(app).get('/bulk-upload/10000000-0000-4000-8000-000000000001').expect(404);

        Object.assign(state.user, { id: 'creator-1' });
        state.batch = { ...state.batch, unitKerjaId: 'sesditjen' };
        await request(app).get('/bulk-upload/10000000-0000-4000-8000-000000000001').expect(404);
    });

    it('recovers only the latest active batch owned by the caller in its authoritative unit', async () => {
        await request(app).get('/bulk-upload/active').expect(200).expect(({ body }) => {
            expect(body.data).toMatchObject({
                batchId: state.batch.batchId,
                createdBy: 'creator-1',
                unitKerjaId: 'ditjen',
            });
        });
        expect(state.service.getLatestActiveBatch).toHaveBeenCalledWith('creator-1', 'ditjen');

        Object.assign(state.user, { id: 'other-admin' });
        await request(app).get('/bulk-upload/active').expect(200).expect(({ body }) => {
            expect(body.data).toBeNull();
        });
        expect(state.service.getLatestActiveBatch).toHaveBeenLastCalledWith('other-admin', 'ditjen');

        state.service.getLatestActiveBatch.mockClear();
        Object.assign(state.user, { id: 'creator-1' });
        await request(app)
            .get('/bulk-upload/active?unitKerjaId=sesditjen')
            .expect(403);
        expect(state.service.getLatestActiveBatch).not.toHaveBeenCalled();
    });

    it('requires a concrete unit to recover a super_admin batch and keeps recovery owner-scoped', async () => {
        Object.assign(state.user, { id: 'super-1', role: 'super_admin', unitKerjaId: null });
        state.batch = { ...state.batch, createdBy: 'super-1' };

        await request(app).get('/bulk-upload/active').expect(400);
        expect(state.service.getLatestActiveBatch).not.toHaveBeenCalled();

        await request(app)
            .get('/bulk-upload/active?unitKerjaId=ditjen')
            .expect(200);
        expect(state.service.getLatestActiveBatch).toHaveBeenCalledWith('super-1', 'ditjen');
    });

    it('advances OCR only through the explicit authenticated mutation endpoint', async () => {
        await request(app)
            .post('/bulk-upload/10000000-0000-4000-8000-000000000001/process')
            .send({})
            .expect(200);

        expect(state.service.processBatch).toHaveBeenCalledWith(
            '10000000-0000-4000-8000-000000000001',
            1,
        );
    });

    it('returns a retryable response when database-backed OCR capacity is full', async () => {
        state.service.processBatch.mockRejectedValueOnce(
            new BulkUploadError(
                'Kapasitas OCR sedang penuh. Coba lagi sebentar.',
                503,
                undefined,
                7,
            ),
        );

        await request(app)
            .post('/bulk-upload/10000000-0000-4000-8000-000000000001/process')
            .send({})
            .expect('Retry-After', '7')
            .expect(503)
            .expect(({ body }) => {
                expect(body).toEqual({
                    success: false,
                    error: 'Kapasitas OCR sedang penuh. Coba lagi sebentar.',
                    retryAfterSeconds: 7,
                });
            });
    });

    it('cancels only an accessible batch through a tombstoning DELETE', async () => {
        await request(app)
            .delete('/bulk-upload/10000000-0000-4000-8000-000000000001')
            .expect(200);
        expect(state.service.cancelBatch).toHaveBeenCalledWith(
            '10000000-0000-4000-8000-000000000001',
        );

        state.service.cancelBatch.mockClear();
        Object.assign(state.user, { id: 'other-admin' });
        await request(app)
            .delete('/bulk-upload/10000000-0000-4000-8000-000000000001')
            .expect(404);
        expect(state.service.cancelBatch).not.toHaveBeenCalled();
    });

    it('allows super_admin across creators while honoring an explicit narrowed unit', async () => {
        Object.assign(state.user, { id: 'super-1', role: 'super_admin', unitKerjaId: null });
        state.batch = { ...state.batch, createdBy: 'another-user' };

        await request(app).get('/bulk-upload/10000000-0000-4000-8000-000000000001').expect(200);
        await request(app)
            .post('/bulk-upload/10000000-0000-4000-8000-000000000001/confirm')
            .send(validConfirmation)
            .expect(200);
        expect(state.service.confirmBatch).toHaveBeenCalledOnce();

        await request(app)
            .get('/bulk-upload/10000000-0000-4000-8000-000000000001?unitKerjaId=sesditjen')
            .expect(404);
        await request(app)
            .get('/bulk-upload/10000000-0000-4000-8000-000000000001?unitKerjaId=ditjen')
            .expect(200);
    });

    it('only confirms an existing batch for its creator in the same unit', async () => {
        await request(app)
            .post('/bulk-upload/10000000-0000-4000-8000-000000000001/confirm')
            .send(validConfirmation)
            .expect(200);

        expect(state.service.confirmBatch).toHaveBeenCalledWith(
            '10000000-0000-4000-8000-000000000001',
            validConfirmation.items,
            expect.objectContaining({
                userId: 'creator-1',
                userEmail: 'creator@example.test',
            }),
        );

        state.service.confirmBatch.mockClear();
        Object.assign(state.user, { id: 'other-admin' });
        await request(app)
            .post('/bulk-upload/10000000-0000-4000-8000-000000000001/confirm')
            .send(validConfirmation)
            .expect(404);

        Object.assign(state.user, { id: 'creator-1' });
        state.batch = { ...state.batch, unitKerjaId: 'sesditjen' };
        await request(app)
            .post('/bulk-upload/10000000-0000-4000-8000-000000000001/confirm')
            .send(validConfirmation)
            .expect(404);

        expect(state.service.confirmBatch).not.toHaveBeenCalled();
    });

    it('does not reveal whether an inaccessible batch exists before validating confirmation data', async () => {
        Object.assign(state.user, { id: 'other-admin' });

        await request(app)
            .post('/bulk-upload/10000000-0000-4000-8000-000000000001/confirm')
            .send({})
            .expect(404);
    });

    it('validates confirmation item identifiers and archive metadata with Zod', async () => {
        await request(app)
            .post('/bulk-upload/10000000-0000-4000-8000-000000000001/confirm')
            .send({
                items: [{
                    itemId: 'not-a-uuid',
                    tahun: 1200,
                    jenisArsip: 'bebas',
                    nomorBerkas: 'x'.repeat(101),
                }],
            })
            .expect(400)
            .expect(({ body }) => {
                expect(body).toMatchObject({ success: false, error: 'Validation failed' });
                expect(body.details.length).toBeGreaterThanOrEqual(4);
            });
        expect(state.service.confirmBatch).not.toHaveBeenCalled();
    });

    it('does not reflect internal upload exceptions to the client', async () => {
        state.service.createBatch.mockRejectedValueOnce(
            new Error('BLOB_READ_WRITE_TOKEN=must-not-leak'),
        );

        const response = await pdfUpload('ditjen').expect(500);

        expect(response.body).toEqual({ success: false, error: 'Upload gagal diproses' });
        expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
    });

    it('returns the caller-owned active batch when a concurrent upload conflicts', async () => {
        state.service.createBatch.mockRejectedValueOnce(
            new BulkUploadError('Masih ada batch aktif untuk unit kerja ini', 409, state.batch.batchId),
        );

        const response = await pdfUpload('ditjen').expect(409);

        expect(response.body).toMatchObject({
            success: false,
            error: 'Masih ada batch aktif untuk unit kerja ini',
            data: { activeBatch: { batchId: state.batch.batchId, createdBy: 'creator-1' } },
        });
        expect(state.service.getLatestActiveBatch).toHaveBeenCalledWith('creator-1', 'ditjen');
    });

    it('stops retaining multipart bytes once the aggregate cap is crossed', async () => {
        state.limits.maxBatchBytes = 8;

        const response = await pdfUpload('ditjen').expect(400);

        expect(response.body).toEqual({
            success: false,
            error: 'Ukuran total satu batch tidak boleh melebihi 100 MB',
        });
        expect(state.service.validateFiles).not.toHaveBeenCalled();
        expect(state.service.createBatch).not.toHaveBeenCalled();
    });
});
