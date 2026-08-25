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
    service: {
        validateFiles: vi.fn(),
        createBatch: vi.fn(),
        processBatch: vi.fn(),
        getBatch: vi.fn(),
        confirmBatch: vi.fn(),
    },
}));

vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { ...state.user };
        next();
    },
}));

vi.mock('../middlewares/rate-limiter.middleware.js', () => ({
    uploadLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/bulk-upload.service.js', () => ({
    bulkUploadService: state.service,
}));

vi.mock('../utils/logger.js', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { default: bulkUploadRouter } = await import('../routes/bulk-upload.routes.js');

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
            batchId: 'batch-1',
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
        state.service.getBatch.mockImplementation(() => state.batch);
        state.service.confirmBatch.mockResolvedValue({
            created: 1,
            failed: 0,
            arsipIds: ['arsip-1'],
        });
    });

    it.each(['staff', 'auditor'])('blocks %s from creating or confirming a batch', async (role) => {
        Object.assign(state.user, { role, unitKerjaId: 'ditjen' });

        await pdfUpload('ditjen').expect(403);
        await request(app)
            .post('/bulk-upload/batch-1/confirm')
            .send({ items: [] })
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
        await request(app).get('/bulk-upload/batch-1').expect(200);

        Object.assign(state.user, { id: 'other-admin' });
        await request(app).get('/bulk-upload/batch-1').expect(404);

        Object.assign(state.user, { id: 'creator-1' });
        state.batch = { ...state.batch, unitKerjaId: 'sesditjen' };
        await request(app).get('/bulk-upload/batch-1').expect(404);
    });

    it('allows super_admin across creators while honoring an explicit narrowed unit', async () => {
        Object.assign(state.user, { id: 'super-1', role: 'super_admin', unitKerjaId: null });
        state.batch = { ...state.batch, createdBy: 'another-user' };

        await request(app).get('/bulk-upload/batch-1').expect(200);
        await request(app)
            .post('/bulk-upload/batch-1/confirm')
            .send({ items: [] })
            .expect(200);
        expect(state.service.confirmBatch).toHaveBeenCalledOnce();

        await request(app)
            .get('/bulk-upload/batch-1?unitKerjaId=sesditjen')
            .expect(404);
        await request(app)
            .get('/bulk-upload/batch-1?unitKerjaId=ditjen')
            .expect(200);
    });

    it('only confirms an existing batch for its creator in the same unit', async () => {
        await request(app)
            .post('/bulk-upload/batch-1/confirm')
            .send({ items: [] })
            .expect(200);

        expect(state.service.confirmBatch).toHaveBeenCalledWith(
            'batch-1',
            [],
            expect.any(Map),
            undefined,
        );

        state.service.confirmBatch.mockClear();
        Object.assign(state.user, { id: 'other-admin' });
        await request(app)
            .post('/bulk-upload/batch-1/confirm')
            .send({ items: [] })
            .expect(404);

        Object.assign(state.user, { id: 'creator-1' });
        state.batch = { ...state.batch, unitKerjaId: 'sesditjen' };
        await request(app)
            .post('/bulk-upload/batch-1/confirm')
            .send({ items: [] })
            .expect(404);

        expect(state.service.confirmBatch).not.toHaveBeenCalled();
    });

    it('does not reveal whether an inaccessible batch exists before validating confirmation data', async () => {
        Object.assign(state.user, { id: 'other-admin' });

        await request(app)
            .post('/bulk-upload/batch-1/confirm')
            .send({})
            .expect(404);
    });
});
