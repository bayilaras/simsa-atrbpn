import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const mocks = vi.hoisted(() => ({
    uploadFile: vi.fn(),
    downloadFile: vi.fn(),
    deleteFile: vi.fn(),
    insert: vi.fn(),
    audit: vi.fn(),
}));

vi.mock('../config/database', () => ({
    db: {
        insert: mocks.insert,
        transaction: async (callback: any) => callback({ insert: mocks.insert }),
    },
}));

vi.mock('../services/blob-storage.service.js', () => ({
    blobStorageService: {
        uploadFile: mocks.uploadFile,
        downloadFile: mocks.downloadFile,
        deleteFile: mocks.deleteFile,
    },
}));

vi.mock('../services/audit-log.service.js', () => ({
    default: { logActionOrThrow: mocks.audit },
}));

const {
    ATTACHMENT_PREFLIGHT_MAX_BYTES,
    FileAttachmentService,
} = await import('../services/file-attachment.service.js');
const { clientBlobUploadService } = await import('../services/client-blob-upload.service.js');
const { ConflictError } = await import('../utils/errors.js');

const directClaim = {
    blobUrl: 'https://store.private.blob.vercel-storage.com/surat-masuk/direct.pdf',
    purpose: 'surat_masuk' as const,
    uploadedBy: '22222222-2222-4222-8222-222222222222',
};

const directAttachment = {
    fileName: 'direct.pdf',
    locator: directClaim.blobUrl,
    uploadedById: directClaim.uploadedBy,
};

describe('FileAttachmentService Blob compensation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.uploadFile.mockResolvedValue({
            url: 'https://store.private.blob.vercel-storage.com/uploads/request-created.pdf',
        });
        mocks.deleteFile.mockResolvedValue(true);
        mocks.audit.mockResolvedValue(undefined);
    });

    it('deletes the exact request-created object when attachment persistence fails', async () => {
        mocks.insert.mockReturnValue({
            values: () => ({
                returning: () => Promise.reject(new Error('database unavailable')),
            }),
        });

        const service = new FileAttachmentService();
        await expect(service.create({
            suratId: '11111111-1111-4111-8111-111111111111',
            suratType: 'masuk',
            fileName: 'request.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-1.7'),
        }, { userId: '22222222-2222-4222-8222-222222222222' })).rejects.toThrow('database unavailable');

        expect(mocks.deleteFile).toHaveBeenCalledOnce();
        expect(mocks.deleteFile).toHaveBeenCalledWith(
            'https://store.private.blob.vercel-storage.com/uploads/request-created.pdf',
        );
    });

    it('keeps the object after its attachment row commits', async () => {
        mocks.insert.mockReturnValue({
            values: () => ({ returning: async () => [{ id: 'attachment-1' }] }),
        });

        const service = new FileAttachmentService();
        await service.create({
            suratId: '11111111-1111-4111-8111-111111111111',
            suratType: 'masuk',
            fileName: 'request.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-1.7'),
        }, { userId: '22222222-2222-4222-8222-222222222222' });

        expect(mocks.deleteFile).not.toHaveBeenCalled();
        expect(mocks.audit).toHaveBeenCalledWith(
            expect.objectContaining({ entityType: 'file_attachment', action: 'create' }),
            expect.objectContaining({ insert: mocks.insert }),
        );
    });

    it('compensates the new Blob when fail-closed audit persistence rejects the transaction', async () => {
        mocks.insert.mockReturnValue({
            values: () => ({ returning: async () => [{
                id: 'attachment-1',
                fileName: 'request.pdf',
                mimeType: 'application/pdf',
                sizeBytes: 8,
                sha256: 'a'.repeat(64),
                storageAccess: 'private',
                malwareScanStatus: 'not_scanned',
            }] }),
        });
        mocks.audit.mockRejectedValueOnce(new Error('audit unavailable'));

        const service = new FileAttachmentService();
        await expect(service.create({
            suratId: '11111111-1111-4111-8111-111111111111',
            suratType: 'masuk',
            fileName: 'request.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-1.7'),
        }, { userId: '22222222-2222-4222-8222-222222222222' }))
            .rejects.toThrow('audit unavailable');

        expect(mocks.deleteFile).toHaveBeenCalledWith(
            'https://store.private.blob.vercel-storage.com/uploads/request-created.pdf',
        );
    });
});

describe('FileAttachmentService direct Blob preflight', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it('rejects a wrong-owner lease before any object-storage download', async () => {
        vi.spyOn(clientBlobUploadService, 'preAuthorizeClaim')
            .mockRejectedValueOnce(new ConflictError('wrong owner'));
        const service = new FileAttachmentService();

        await expect(service.prepareExisting(directAttachment, {
            clientBlobClaim: directClaim,
            expectedPurpose: 'surat_masuk',
        })).rejects.toMatchObject({ statusCode: 409 });

        expect(mocks.downloadFile).not.toHaveBeenCalled();
    });

    it('rejects a direct attachment without a lease before download', async () => {
        const service = new FileAttachmentService();

        await expect(service.prepareExisting(directAttachment, {
            expectedPurpose: 'surat_masuk',
        })).rejects.toMatchObject({ statusCode: 409 });

        expect(mocks.downloadFile).not.toHaveBeenCalled();
    });

    it('keeps multipart buffers off both lease lookup and object download', async () => {
        const authorize = vi.spyOn(clientBlobUploadService, 'preAuthorizeClaim');
        const service = new FileAttachmentService();

        await expect(service.prepareExisting({
            ...directAttachment,
            buffer: Buffer.from('%PDF-1.7'),
            mimeType: 'application/pdf',
        })).resolves.toMatchObject({ mimeType: 'application/pdf', sizeBytes: 8 });

        expect(authorize).not.toHaveBeenCalled();
        expect(mocks.downloadFile).not.toHaveBeenCalled();
    });

    it('destroys a stalled stream and returns 503 at the preflight deadline', async () => {
        vi.spyOn(clientBlobUploadService, 'preAuthorizeClaim').mockResolvedValueOnce({} as any);
        const stream = new Readable({ read() { /* intentionally stalled */ } });
        const destroy = vi.spyOn(stream, 'destroy');
        mocks.downloadFile.mockResolvedValueOnce({
            stream,
            mimeType: 'application/pdf',
            fileName: 'direct.pdf',
        });
        const service = new FileAttachmentService();

        await expect(service.prepareExisting(directAttachment, {
            clientBlobClaim: directClaim,
            expectedPurpose: 'surat_masuk',
            timeoutMs: 20,
        })).rejects.toMatchObject({ statusCode: 503 });

        expect(destroy).toHaveBeenCalled();
    });

    it('destroys an oversized direct stream and returns 413', async () => {
        vi.spyOn(clientBlobUploadService, 'preAuthorizeClaim').mockResolvedValueOnce({} as any);
        const stream = Readable.from([
            Buffer.alloc(ATTACHMENT_PREFLIGHT_MAX_BYTES),
            Buffer.from([0]),
        ]);
        const destroy = vi.spyOn(stream, 'destroy');
        mocks.downloadFile.mockResolvedValueOnce({
            stream,
            mimeType: 'application/pdf',
            fileName: 'direct.pdf',
        });
        const service = new FileAttachmentService();

        await expect(service.prepareExisting(directAttachment, {
            clientBlobClaim: directClaim,
            expectedPurpose: 'surat_masuk',
        })).rejects.toMatchObject({ statusCode: 413 });

        expect(destroy).toHaveBeenCalled();
    });

    it('maps a missing object to 410 and transient provider failures to 503', async () => {
        vi.spyOn(clientBlobUploadService, 'preAuthorizeClaim').mockResolvedValue({} as any);
        const service = new FileAttachmentService();

        mocks.downloadFile.mockResolvedValueOnce(null);
        await expect(service.prepareExisting(directAttachment, {
            clientBlobClaim: directClaim,
            expectedPurpose: 'surat_masuk',
        })).rejects.toMatchObject({ statusCode: 410 });

        mocks.downloadFile.mockRejectedValueOnce(new Error('provider unavailable'));
        await expect(service.prepareExisting(directAttachment, {
            clientBlobClaim: directClaim,
            expectedPurpose: 'surat_masuk',
        })).rejects.toMatchObject({ statusCode: 503 });
    });
});
