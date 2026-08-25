import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
    suratKeluar: {
        findAll: vi.fn(),
        findById: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        registerExisting: vi.fn(),
        archive: vi.fn(),
        getNextNumber: vi.fn(),
        getStats: vi.fn(),
        getSourceSuratMasuk: vi.fn(),
        findByIdWithLinks: vi.fn(),
        replyTargetExistsInUnit: vi.fn(),
    },
    suratMasuk: {
        findAll: vi.fn(),
        findById: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        archive: vi.fn(),
        getNextNumber: vi.fn(),
        getStats: vi.fn(),
        getPendingForReply: vi.fn(),
        getBalasan: vi.fn(),
        findByIdWithLinks: vi.fn(),
    },
    attachment: {
        create: vi.fn(),
        findBySurat: vi.fn(),
        findById: vi.fn(),
        delete: vi.fn(),
    },
    blobUpload: vi.fn(),
    audit: vi.fn(),
    recordAccess: {
        check: vi.fn(),
    },
}));

vi.mock('../../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = {
            id: '550e8400-e29b-41d4-a716-446655440001',
            email: 'admin@example.test',
            role: 'admin_sesditjen',
            unitKerjaId: 'ditjen',
        };
        next();
    },
}));

vi.mock('../../middlewares/role.middleware', () => ({
    canWriteMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middlewares/rate-limiter.middleware', () => ({
    uploadLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middlewares/validate.middleware', () => ({
    validateBody: () => (_req: any, _res: any, next: any) => next(),
    validateQuery: () => (req: any, res: any, next: any) => {
        res.locals.validatedQuery = req.query;
        next();
    },
    validateIdParam: () => (_req: any, _res: any, next: any) => next(),
    uuidParamValidator: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/surat-keluar.service', () => ({
    suratKeluarService: mocks.suratKeluar,
}));

vi.mock('../../services/surat-masuk.service', () => ({
    suratMasukService: mocks.suratMasuk,
}));

vi.mock('../../services/file-attachment.service', () => ({
    fileAttachmentService: mocks.attachment,
}));

vi.mock('../../services/record-access.service', () => ({
    recordAccessService: mocks.recordAccess,
    allowedSecurityClassifications: () => ['biasa', 'terbatas'],
    isAllowedForClassification: (_user: any, value?: string | null) =>
        !['rahasia', 'sangat_rahasia'].includes((value || 'biasa').toLowerCase()),
}));

vi.mock('../../services/blob-storage.service', () => ({
    blobStorageService: { uploadFile: mocks.blobUpload },
}));

vi.mock('../../services/audit-log.service', () => ({
    default: { logAction: mocks.audit },
}));

import suratKeluarRouter from '../surat-keluar.routes';
import suratMasukRouter from '../surat-masuk.routes';
import uploadRouter from '../upload.routes';

const app = express();
app.use(express.json());
app.use('/api/surat-keluar', suratKeluarRouter);
app.use('/api/surat-masuk', suratMasukRouter);
app.use('/api/upload', uploadRouter);
app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error?.statusCode || 400).json({ error: error?.message || 'Request failed' });
});

const validSuratKeluar = {
    unitKerjaId: 'ditjen',
    tahun: 2026,
    naskahDinas: 'Surat Dinas',
    nomorSurat: '1/AT.01/VIII/2026',
    tanggalSurat: '2026-08-25',
    perihal: 'Pengadaan tanah',
    kepada: 'Kepala Kantor Pertanahan',
    linkDokumen: '',
};

describe('surat and attachment route security policy', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.audit.mockResolvedValue(undefined);
        mocks.recordAccess.check.mockResolvedValue({
            exists: true,
            allowed: true,
            mutable: true,
            unitKerjaId: 'sesditjen',
            classification: 'terbatas',
            grantId: '550e8400-e29b-41d4-a716-446655440099',
            grantAccessMode: 'manage',
        });
    });

    it('validates surat keluar against DB fields and forces the authenticated unit', async () => {
        mocks.suratKeluar.create.mockImplementation(async (payload: any) => ({
            id: '550e8400-e29b-41d4-a716-446655440010',
            ...payload,
            filePath: 'https://store.private.blob.vercel-storage.com/surat-keluar/internal.pdf',
        }));

        const response = await request(app)
            .post('/api/surat-keluar')
            .send(validSuratKeluar);

        expect(response.status).toBe(201);
        expect(mocks.suratKeluar.create).toHaveBeenCalledWith(expect.objectContaining({
            unitKerjaId: 'sesditjen',
            kepada: validSuratKeluar.kepada,
        }));
        expect(response.body.data).toMatchObject({
            hasFile: true,
            filePath: '/api/files/surat_keluar/550e8400-e29b-41d4-a716-446655440010',
        });
        expect(JSON.stringify(response.body)).not.toContain('blob.vercel-storage.com');
    });

    it('rejects the obsolete tujuan-only outgoing payload', async () => {
        const { kepada: _kepada, ...withoutKepada } = validSuratKeluar;
        const response = await request(app)
            .post('/api/surat-keluar')
            .send({ ...withoutKepada, tujuan: 'Field lama' });

        expect(response.status).toBe(400);
        expect(mocks.suratKeluar.create).not.toHaveBeenCalled();
    });

    it('rejects an outgoing client locator with the wrong record prefix', async () => {
        const response = await request(app)
            .post('/api/surat-keluar')
            .send({
                ...validSuratKeluar,
                filePath: 'https://store.private.blob.vercel-storage.com/surat-masuk/wrong.pdf',
            });

        expect(response.status).toBe(400);
        expect(mocks.suratKeluar.create).not.toHaveBeenCalled();
    });

    it('rejects ZIP multipart files before creating a surat', async () => {
        const response = await request(app)
            .post('/api/surat-keluar')
            .field(validSuratKeluar)
            .attach('file', Buffer.from('PK\u0003\u0004'), 'archive.zip');

        expect(response.status).toBe(400);
        expect(mocks.suratKeluar.create).not.toHaveBeenCalled();
    });

    it('requires an update reply target to exist in the outgoing letter unit', async () => {
        mocks.suratKeluar.findById.mockResolvedValue({
            id: '550e8400-e29b-41d4-a716-446655440010',
            unitKerjaId: 'sesditjen',
        });
        mocks.suratKeluar.replyTargetExistsInUnit.mockResolvedValue(false);

        const response = await request(app)
            .put('/api/surat-keluar/550e8400-e29b-41d4-a716-446655440010')
            .send({ balasanUntuk: '550e8400-e29b-41d4-a716-446655440020' });

        expect(response.status).toBe(400);
        expect(mocks.suratKeluar.replyTargetExistsInUnit).toHaveBeenCalledWith(
            '550e8400-e29b-41d4-a716-446655440020',
            'sesditjen',
        );
        expect(mocks.suratKeluar.update).not.toHaveBeenCalled();
    });

    it('conceals a controlled record from mutation without manage access', async () => {
        const record = {
            id: '550e8400-e29b-41d4-a716-446655440010',
            unitKerjaId: 'sesditjen',
            isArchived: false,
            perihal: 'Sebelum',
        };
        mocks.suratKeluar.findById.mockResolvedValue(record);
        mocks.recordAccess.check.mockResolvedValue({
            exists: true,
            allowed: true,
            mutable: false,
            unitKerjaId: 'sesditjen',
            grantAccessMode: 'view',
        });

        await request(app)
            .put('/api/surat-keluar/550e8400-e29b-41d4-a716-446655440010')
            .send({ perihal: 'Sesudah' })
            .expect(404);
        expect(mocks.suratKeluar.update).not.toHaveBeenCalled();

        mocks.recordAccess.check.mockResolvedValue({
            exists: true,
            allowed: true,
            mutable: true,
            unitKerjaId: 'sesditjen',
            grantAccessMode: 'manage',
        });
        mocks.suratKeluar.update.mockResolvedValue({ ...record, perihal: 'Sesudah' });

        await request(app)
            .put('/api/surat-keluar/550e8400-e29b-41d4-a716-446655440010')
            .send({ perihal: 'Sesudah' })
            .expect(200);
        expect(mocks.suratKeluar.update).toHaveBeenCalledTimes(1);
    });

    it('does not update or delete an outgoing evidentiary source after archiving', async () => {
        mocks.suratKeluar.findById.mockResolvedValue({
            id: '550e8400-e29b-41d4-a716-446655440010',
            unitKerjaId: 'sesditjen',
            isArchived: true,
        });

        await request(app)
            .put('/api/surat-keluar/550e8400-e29b-41d4-a716-446655440010')
            .send({ perihal: 'Rewrite' })
            .expect(409);
        await request(app)
            .delete('/api/surat-keluar/550e8400-e29b-41d4-a716-446655440010')
            .expect(409);

        expect(mocks.suratKeluar.update).not.toHaveBeenCalled();
        expect(mocks.suratKeluar.delete).not.toHaveBeenCalled();
    });

    it('does not update or delete an incoming evidentiary source after archiving', async () => {
        mocks.suratMasuk.findById.mockResolvedValue({
            id: '550e8400-e29b-41d4-a716-446655440030',
            unitKerjaId: 'sesditjen',
            sifatSurat: 'biasa',
            isArchived: true,
        });

        await request(app)
            .put('/api/surat-masuk/550e8400-e29b-41d4-a716-446655440030')
            .send({ perihal: 'Rewrite' })
            .expect(409);
        await request(app)
            .delete('/api/surat-masuk/550e8400-e29b-41d4-a716-446655440030')
            .expect(409);

        expect(mocks.suratMasuk.update).not.toHaveBeenCalled();
        expect(mocks.suratMasuk.delete).not.toHaveBeenCalled();
    });

    it('checks an incoming parent and filters replies to that parent unit', async () => {
        mocks.suratMasuk.findById.mockResolvedValue({
            id: '550e8400-e29b-41d4-a716-446655440030',
            unitKerjaId: 'sesditjen',
        });
        mocks.suratMasuk.getBalasan.mockResolvedValue([{
            id: '550e8400-e29b-41d4-a716-446655440040',
            filePath: 'https://store.private.blob.vercel-storage.com/surat-keluar/internal.pdf',
        }]);

        const response = await request(app)
            .get('/api/surat-masuk/550e8400-e29b-41d4-a716-446655440030/balasan');

        expect(response.status).toBe(200);
        expect(mocks.suratMasuk.getBalasan).toHaveBeenCalledWith(
            '550e8400-e29b-41d4-a716-446655440030',
            'sesditjen',
        );
        expect(response.body.data[0].filePath)
            .toBe('/api/files/surat_keluar/550e8400-e29b-41d4-a716-446655440040');
    });

    it('does not invoke archive-full when the incoming parent is outside scope', async () => {
        mocks.suratMasuk.findById.mockResolvedValue(null);

        const response = await request(app)
            .post('/api/surat-masuk/550e8400-e29b-41d4-a716-446655440030/archive-full')
            .send({});

        expect(response.status).toBe(404);
    });

    it('returns 409 and never hard-deletes an attachment bitstream', async () => {
        const response = await request(app)
            .delete('/api/upload/550e8400-e29b-41d4-a716-446655440050');

        expect(response.status).toBe(409);
        expect(response.body.code).toBe('DISPOSITION_REQUIRED');
        expect(mocks.attachment.findById).not.toHaveBeenCalled();
        expect(mocks.attachment.delete).not.toHaveBeenCalled();
    });
});
