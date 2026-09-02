import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
    ConflictError,
    GoneError,
    PayloadTooLargeError,
    ServiceUnavailableError,
} from '../../utils/errors.js';

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
    blobDelete: vi.fn(),
    blobDeleteGeneration: vi.fn(),
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
    blobStorageService: {
        uploadFile: mocks.blobUpload,
        uploadUntrustedFile: mocks.blobUpload,
        deleteFile: mocks.blobDelete,
        deleteFileGeneration: mocks.blobDeleteGeneration,
    },
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
    numberingMode: 'manual',
    nomorSurat: '1/AT.01/VIII/2026',
    tanggalSurat: '2026-08-25',
    perihal: 'Pengadaan tanah',
    kepada: 'Kepala Kantor Pertanahan',
    linkDokumen: '',
};

const validSuratMasuk = {
    unitKerjaId: 'ditjen',
    tahun: 2026,
    nomorSurat: 'SM-1/VIII/2026',
    tanggalSurat: '2026-08-25',
    perihal: 'Permohonan data',
    dari: 'Kantor Pertanahan',
    sifatSurat: 'biasa',
};

describe('surat and attachment route security policy', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.audit.mockResolvedValue(undefined);
        mocks.blobDelete.mockResolvedValue(true);
        mocks.blobDeleteGeneration.mockResolvedValue(true);
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
        expect(mocks.suratKeluar.create).toHaveBeenCalledWith(
            expect.objectContaining({
                unitKerjaId: 'sesditjen',
                kepada: validSuratKeluar.kepada,
            }),
            expect.objectContaining({
                userId: '550e8400-e29b-41d4-a716-446655440001',
                userEmail: 'admin@example.test',
            }),
            undefined,
            undefined,
        );
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

    it('deletes only the Blob created by a failed outgoing multipart create', async () => {
        const blobUrl = 'https://store.private.blob.vercel-storage.com/surat-keluar/request-created.pdf';
        mocks.blobUpload.mockResolvedValue({ url: blobUrl });
        mocks.suratKeluar.create.mockRejectedValue(new Error('audit unavailable'));

        await request(app)
            .post('/api/surat-keluar')
            .field(validSuratKeluar)
            .attach('file', Buffer.from('%PDF-1.7\nrequest'), {
                filename: 'request.pdf',
                contentType: 'application/pdf',
            })
            .expect(400);

        expect(mocks.blobDelete).toHaveBeenCalledOnce();
        expect(mocks.blobDelete).toHaveBeenCalledWith(blobUrl);
    });

    it('deletes only the exact GCS generation after a failed outgoing multipart create', async () => {
        const locator = 'gs://simsa-upload/surat-keluar/request-created.pdf';
        const generation = '1735689600123456';
        mocks.blobUpload.mockResolvedValue({ url: locator, generation });
        mocks.suratKeluar.create.mockRejectedValue(new Error('audit unavailable'));

        await request(app)
            .post('/api/surat-keluar')
            .field(validSuratKeluar)
            .attach('file', Buffer.from('%PDF-1.7\nrequest'), {
                filename: 'request.pdf',
                contentType: 'application/pdf',
            })
            .expect(400);

        expect(mocks.blobDeleteGeneration).toHaveBeenCalledWith(locator, generation);
        expect(mocks.blobDelete).not.toHaveBeenCalled();
    });

    it('passes an outgoing multipart attachment into the canonical surat transaction', async () => {
        const blobUrl = 'https://store.private.blob.vercel-storage.com/surat-keluar/request-created.pdf';
        mocks.blobUpload.mockResolvedValue({ url: blobUrl });
        mocks.suratKeluar.create.mockImplementation(async (payload: any) => ({
            id: '550e8400-e29b-41d4-a716-446655440010',
            ...payload,
        }));

        await request(app)
            .post('/api/surat-keluar')
            .field(validSuratKeluar)
            .attach('file', Buffer.from('%PDF-1.7\nrequest'), {
                filename: 'request.pdf',
                contentType: 'application/pdf',
            })
            .expect(201);

        expect(mocks.suratKeluar.create).toHaveBeenCalledWith(
            expect.objectContaining({ filePath: `blob:${blobUrl}` }),
            expect.any(Object),
            undefined,
            expect.objectContaining({
                fileName: 'request.pdf',
                locator: `blob:${blobUrl}`,
                mimeType: 'application/pdf',
                buffer: expect.any(Buffer),
            }),
        );
        expect(mocks.blobDelete).not.toHaveBeenCalled();
    });

    it('passes an incoming client Blob lease and attachment into one canonical transaction', async () => {
        const blobUrl = 'https://store.private.blob.vercel-storage.com/surat-masuk/client-created.pdf';
        mocks.suratMasuk.create.mockImplementation(async (payload: any) => ({
            id: '550e8400-e29b-41d4-a716-446655440030',
            ...payload,
        }));

        await request(app)
            .post('/api/surat-masuk')
            .send({
                ...validSuratMasuk,
                filePath: blobUrl,
                fileOriginalName: 'client-created.pdf',
            })
            .expect(201);

        expect(mocks.suratMasuk.create).toHaveBeenCalledWith(
            expect.objectContaining({ filePath: blobUrl }),
            expect.any(Object),
            expect.objectContaining({
                blobUrl,
                purpose: 'surat_masuk',
                uploadedBy: '550e8400-e29b-41d4-a716-446655440001',
            }),
            expect.objectContaining({
                fileName: 'client-created.pdf',
                locator: blobUrl,
            }),
        );
        expect(mocks.blobDelete).not.toHaveBeenCalled();
    });

    it.each([
        ['lease conflict', new ConflictError('Lease unggahan tidak dapat dipakai.'), 409],
        ['missing object', new GoneError('Objek lampiran sudah tidak tersedia.'), 410],
        ['oversized object', new PayloadTooLargeError('Lampiran melebihi batas.'), 413],
        ['transient provider', new ServiceUnavailableError('Object storage sementara tidak tersedia.'), 503],
    ])('preserves the %s preflight HTTP status', async (_label, error, expectedStatus) => {
        const blobUrl = 'https://store.private.blob.vercel-storage.com/surat-masuk/client-created.pdf';
        mocks.suratMasuk.create.mockRejectedValueOnce(error);

        const response = await request(app)
            .post('/api/surat-masuk')
            .send({
                ...validSuratMasuk,
                filePath: blobUrl,
                fileOriginalName: 'client-created.pdf',
            });

        expect(response.status).toBe(expectedStatus);
        expect(response.body.error).toBe(error.message);
        expect(mocks.blobDelete).not.toHaveBeenCalled();
    });

    it('does not reflect object-storage errors to upload clients', async () => {
        mocks.blobUpload.mockRejectedValueOnce(new Error('secret token and provider detail'));

        const response = await request(app)
            .post('/api/surat-keluar')
            .field(validSuratKeluar)
            .attach('file', Buffer.from('%PDF-1.7\nrequest'), {
                filename: 'request.pdf',
                contentType: 'application/pdf',
            });

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({
            error: 'Gagal mengunggah file',
            code: 'BLOB_UPLOAD_FAILED',
        });
        expect(JSON.stringify(response.body)).not.toContain('secret token');
    });

    it('does not delete a user-supplied Blob locator when create fails', async () => {
        const suppliedUrl = 'https://store.private.blob.vercel-storage.com/surat-keluar/client-created.pdf';
        mocks.suratKeluar.create.mockRejectedValue(new Error('lease unavailable'));

        await request(app)
            .post('/api/surat-keluar')
            .send({
                ...validSuratKeluar,
                filePath: suppliedUrl,
                fileOriginalName: 'client-created.pdf',
            })
            .expect(400);

        expect(mocks.blobDelete).not.toHaveBeenCalled();
    });

    it('compensates an incoming multipart Blob when transactional create fails', async () => {
        const blobUrl = 'https://store.private.blob.vercel-storage.com/surat-masuk/request-created.pdf';
        mocks.blobUpload.mockResolvedValue({ url: blobUrl });
        mocks.suratMasuk.create.mockRejectedValue(new Error('outbox unavailable'));

        await request(app)
            .post('/api/surat-masuk')
            .field(validSuratMasuk)
            .attach('file', Buffer.from('%PDF-1.7\nrequest'), {
                filename: 'request.pdf',
                contentType: 'application/pdf',
            })
            .expect(400);

        expect(mocks.blobDelete).toHaveBeenCalledWith(blobUrl);
    });

    it('carries the incoming multipart GCS generation into transaction and compensation', async () => {
        const locator = 'gs://simsa-upload/surat-masuk/request-created.pdf';
        const generation = '1735689600123456';
        mocks.blobUpload.mockResolvedValue({ url: locator, generation });
        mocks.suratMasuk.create.mockRejectedValue(new Error('outbox unavailable'));

        await request(app)
            .post('/api/surat-masuk')
            .field(validSuratMasuk)
            .attach('file', Buffer.from('%PDF-1.7\nrequest'), {
                filename: 'request.pdf',
                contentType: 'application/pdf',
            })
            .expect(400);

        expect(mocks.suratMasuk.create).toHaveBeenCalledWith(
            expect.objectContaining({ filePath: `blob:${locator}` }),
            expect.any(Object),
            undefined,
            expect.objectContaining({ objectGeneration: generation }),
        );
        expect(mocks.blobDeleteGeneration).toHaveBeenCalledWith(locator, generation);
        expect(mocks.blobDelete).not.toHaveBeenCalled();
    });

    it('compensates only newly uploaded multipart replacements when update fails', async () => {
        const outgoingId = '550e8400-e29b-41d4-a716-446655440010';
        const incomingId = '550e8400-e29b-41d4-a716-446655440030';
        const outgoingBlob = 'https://store.private.blob.vercel-storage.com/surat-keluar/new-request.pdf';
        const incomingBlob = 'https://store.private.blob.vercel-storage.com/surat-masuk/new-request.pdf';
        mocks.suratKeluar.findById.mockResolvedValue({
            id: outgoingId,
            unitKerjaId: 'sesditjen',
            isArchived: false,
            approvalStatus: 'draft',
            filePath: 'blob:https://store.private.blob.vercel-storage.com/surat-keluar/old.pdf',
        });
        mocks.suratMasuk.findById.mockResolvedValue({
            id: incomingId,
            unitKerjaId: 'sesditjen',
            sifatSurat: 'biasa',
            isArchived: false,
            filePath: 'blob:https://store.private.blob.vercel-storage.com/surat-masuk/old.pdf',
        });
        mocks.suratKeluar.update.mockRejectedValue(new Error('database unavailable'));
        mocks.suratMasuk.update.mockRejectedValue(new Error('database unavailable'));
        mocks.blobUpload
            .mockResolvedValueOnce({ url: outgoingBlob })
            .mockResolvedValueOnce({ url: incomingBlob });

        await request(app)
            .put(`/api/surat-keluar/${outgoingId}`)
            .attach('file', Buffer.from('%PDF-1.7\noutgoing'), {
                filename: 'outgoing.pdf',
                contentType: 'application/pdf',
            })
            .expect(400);
        await request(app)
            .put(`/api/surat-masuk/${incomingId}`)
            .attach('file', Buffer.from('%PDF-1.7\nincoming'), {
                filename: 'incoming.pdf',
                contentType: 'application/pdf',
            })
            .expect(400);

        expect(mocks.blobDelete).toHaveBeenCalledWith(outgoingBlob);
        expect(mocks.blobDelete).toHaveBeenCalledWith(incomingBlob);
        expect(mocks.blobDelete).not.toHaveBeenCalledWith(expect.stringContaining('/old.pdf'));
    });

    it('requires an update reply target to exist in the outgoing letter unit', async () => {
        mocks.suratKeluar.findById.mockResolvedValue({
            id: '550e8400-e29b-41d4-a716-446655440010',
            unitKerjaId: 'sesditjen',
            approvalStatus: 'draft',
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
            approvalStatus: 'draft',
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

    it('locks an outgoing letter while approval is pending', async () => {
        mocks.suratKeluar.findById.mockResolvedValue({
            id: '550e8400-e29b-41d4-a716-446655440010',
            unitKerjaId: 'sesditjen',
            isArchived: false,
            approvalStatus: 'pending',
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
