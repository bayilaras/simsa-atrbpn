import { Readable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    select: vi.fn(),
    accessCheck: vi.fn(),
    markGrantUsed: vi.fn(),
    downloadFile: vi.fn(),
    audit: vi.fn(),
}));

vi.mock('../../config/database.js', () => ({
    db: { select: mocks.select },
}));

vi.mock('../../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = {
            id: '10000000-0000-4000-8000-000000000001',
            email: 'reader@example.test',
            role: 'staff',
            unitKerjaId: 'unit-test',
        };
        next();
    },
}));

vi.mock('../../middlewares/validate.middleware.js', () => ({
    validateIdParam: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/record-access.service.js', () => ({
    recordAccessService: {
        check: mocks.accessCheck,
        markGrantUsed: mocks.markGrantUsed,
    },
}));

vi.mock('../../services/blob-storage.service.js', () => ({
    blobStorageService: { downloadFile: mocks.downloadFile },
}));

vi.mock('../../services/audit-log.service.js', () => ({
    auditLogService: { logActionOrThrow: mocks.audit },
}));

const { default: fileAccessRouter } = await import('../file-access.routes.js');

const app = express();
app.use('/api/files', fileAccessRouter);

const locator = 'gs://simsa-final/surat-masuk/final.pdf';
const generation = '1735689600999999';
const attachment = {
    id: '20000000-0000-4000-8000-000000000001',
    entityType: 'surat_masuk',
    entityId: '30000000-0000-4000-8000-000000000001',
    fileName: 'final.pdf',
    fileUrl: locator,
    objectGeneration: generation,
    driveFileId: null,
    storageAccess: 'private',
    sha256: 'a'.repeat(64),
    integrityStatus: 'verified',
    malwareScanStatus: 'clean',
};

function limitedRows(rows: unknown[]) {
    return {
        from: () => ({
            where: () => ({
                limit: async () => rows,
            }),
        }),
    };
}

function unrestrictedRows(rows: unknown[]) {
    return {
        from: () => ({
            where: async () => rows,
        }),
    };
}

describe('authorized GCS file access', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.accessCheck.mockResolvedValue({
            exists: true,
            allowed: true,
            grantId: null,
        });
        mocks.audit.mockResolvedValue(undefined);
        mocks.downloadFile.mockResolvedValue({
            stream: Readable.from([Buffer.from('%PDF-generation-pinned')]),
            mimeType: 'application/pdf',
            fileName: 'final.pdf',
        });
    });

    it('pins an attachment download to attachment.objectGeneration', async () => {
        mocks.select.mockReturnValueOnce(limitedRows([attachment]));

        await request(app)
            .get(`/api/files/attachment/${attachment.id}`)
            .expect(200);

        expect(mocks.downloadFile).toHaveBeenCalledWith(locator, { generation });
    });

    it('pins a surat download to the matching released registration generation', async () => {
        mocks.select
            .mockReturnValueOnce(limitedRows([{
                filePath: `blob:${locator}`,
                fileName: 'final.pdf',
            }]))
            .mockReturnValueOnce(unrestrictedRows([attachment]));

        await request(app)
            .get(`/api/files/surat_masuk/${attachment.entityId}`)
            .expect(200);

        expect(mocks.downloadFile).toHaveBeenCalledWith(locator, { generation });
    });

    it('fails closed and destroys the provider stream when audit persistence fails', async () => {
        const stream = Readable.from([Buffer.from('%PDF-must-not-leak')]);
        const destroy = vi.spyOn(stream, 'destroy');
        mocks.select.mockReturnValueOnce(limitedRows([attachment]));
        mocks.downloadFile.mockResolvedValueOnce({
            stream,
            mimeType: 'application/pdf',
            fileName: 'final.pdf',
        });
        mocks.audit.mockRejectedValueOnce(new Error('audit unavailable'));

        await request(app)
            .get(`/api/files/attachment/${attachment.id}`)
            .expect(500);

        expect(destroy).toHaveBeenCalledOnce();
    });
});
