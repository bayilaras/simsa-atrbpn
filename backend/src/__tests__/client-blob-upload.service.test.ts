import { beforeEach, describe, expect, it, vi } from 'vitest';

const resultQueue: any[] = [];
const mocks = vi.hoisted(() => ({
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    deleteFile: vi.fn(),
}));

function chain(): any {
    return new Proxy({}, {
        get(_target, property) {
            if (property === 'then') {
                const value = resultQueue.shift() ?? [];
                return (resolve: (result: any) => void) => resolve(value);
            }
            return () => chain();
        },
    });
}

vi.mock('../config/database.js', () => ({
    db: {
        insert: mocks.insert,
        select: mocks.select,
        update: mocks.update,
    },
}));

vi.mock('../services/blob-storage.service.js', () => ({
    blobStorageService: { deleteFile: mocks.deleteFile },
}));

const {
    ClientBlobUploadService,
    clientBlobClaimTtlMs,
} = await import('../services/client-blob-upload.service.js');

describe('ClientBlobUploadService', () => {
    beforeEach(() => {
        resultQueue.length = 0;
        vi.clearAllMocks();
        mocks.insert.mockImplementation(() => chain());
        mocks.select.mockImplementation(() => chain());
        mocks.update.mockImplementation(() => chain());
        mocks.deleteFile.mockResolvedValue(true);
    });

    it('records only a callback-proven canonical private Blob locator', async () => {
        const now = new Date('2026-08-28T00:00:00.000Z');
        const blobUrl = 'https://store.private.blob.vercel-storage.com/surat-masuk/evidence-random.pdf';
        resultQueue.push([{
            id: 'lease-1',
            blobUrl,
            pathname: 'surat-masuk/evidence-random.pdf',
            purpose: 'surat_masuk',
            uploadedBy: '11111111-1111-4111-8111-111111111111',
            status: 'pending',
        }]);

        const service = new ClientBlobUploadService();
        const recorded = await service.recordCompletedUpload({
            blobUrl,
            pathname: 'surat-masuk/evidence-random.pdf',
            purpose: 'surat_masuk',
            uploadedBy: '11111111-1111-4111-8111-111111111111',
        }, now);

        expect(recorded.status).toBe('pending');
        expect(mocks.insert).toHaveBeenCalledOnce();
    });

    it('rejects public, cross-purpose, and user-supplied callback locators before persistence', async () => {
        const service = new ClientBlobUploadService();
        await expect(service.recordCompletedUpload({
            blobUrl: 'https://store.blob.vercel-storage.com/surat-masuk/file.pdf',
            pathname: 'surat-masuk/file.pdf',
            purpose: 'surat_masuk',
            uploadedBy: '11111111-1111-4111-8111-111111111111',
        })).rejects.toThrow(/private Blob/);
        await expect(service.recordCompletedUpload({
            blobUrl: 'https://store.private.blob.vercel-storage.com/surat-keluar/file.pdf',
            pathname: 'surat-keluar/file.pdf',
            purpose: 'surat_masuk',
            uploadedBy: '11111111-1111-4111-8111-111111111111',
        })).rejects.toThrow(/ruang unggah/);
        expect(mocks.insert).not.toHaveBeenCalled();
    });

    it('claims a live lease with the caller transaction and fails closed otherwise', async () => {
        const service = new ClientBlobUploadService();
        const executor = { update: vi.fn(() => chain()) };
        resultQueue.push([{ id: 'lease-1', status: 'claimed' }]);

        await expect(service.claimWithExecutor(executor, {
            blobUrl: 'blob:https://store.private.blob.vercel-storage.com/surat-masuk/file.pdf',
            purpose: 'surat_masuk',
            uploadedBy: '11111111-1111-4111-8111-111111111111',
        }, 'surat_masuk', '22222222-2222-4222-8222-222222222222'))
            .resolves.toMatchObject({ status: 'claimed' });

        resultQueue.push([]);
        await expect(service.claimWithExecutor(executor, {
            blobUrl: 'https://store.private.blob.vercel-storage.com/surat-masuk/file.pdf',
            purpose: 'surat_masuk',
            uploadedBy: '33333333-3333-4333-8333-333333333333',
        }, 'surat_masuk', '22222222-2222-4222-8222-222222222222'))
            .rejects.toThrow(/Lease unggahan Blob/);
    });

    it('pre-authorizes only an exact pending lease with enough time remaining', async () => {
        const service = new ClientBlobUploadService();
        const claim = {
            blobUrl: 'blob:https://store.private.blob.vercel-storage.com/surat-masuk/file.pdf',
            purpose: 'surat_masuk' as const,
            uploadedBy: '11111111-1111-4111-8111-111111111111',
        };
        resultQueue.push([{
            id: 'lease-1',
            ...claim,
            blobUrl: claim.blobUrl.slice('blob:'.length),
            status: 'pending',
            expiresAt: new Date('2026-08-28T12:01:00.000Z'),
        }]);

        await expect(service.preAuthorizeClaim(
            claim,
            35_000,
            new Date('2026-08-28T12:00:00.000Z'),
        )).resolves.toMatchObject({ id: 'lease-1', status: 'pending' });

        resultQueue.push([]);
        await expect(service.preAuthorizeClaim(
            { ...claim, uploadedBy: '33333333-3333-4333-8333-333333333333' },
            35_000,
            new Date('2026-08-28T12:00:00.000Z'),
        )).rejects.toMatchObject({ statusCode: 409 });
    });

    it('reserves and deletes only an expired unclaimed lease selected by the database', async () => {
        const now = new Date('2026-08-28T12:00:00.000Z');
        const candidate = {
            id: 'lease-expired',
            blobUrl: 'https://store.private.blob.vercel-storage.com/surat-keluar/orphan.pdf',
            status: 'pending',
            expiresAt: new Date('2026-08-27T12:00:00.000Z'),
        };
        resultQueue.push([candidate], [{ ...candidate, status: 'cleanup_started' }], []);

        const service = new ClientBlobUploadService();
        const result = await service.cleanupExpired(10, now);

        expect(result).toEqual({ examined: 1, deleted: 1, failed: 0 });
        expect(mocks.deleteFile).toHaveBeenCalledOnce();
        expect(mocks.deleteFile).toHaveBeenCalledWith(candidate.blobUrl);
    });

    it('validates the configured expiry window', () => {
        expect(clientBlobClaimTtlMs({ CLIENT_BLOB_UPLOAD_TTL_HOURS: '24' } as any))
            .toBe(24 * 60 * 60 * 1000);
        expect(() => clientBlobClaimTtlMs({ CLIENT_BLOB_UPLOAD_TTL_HOURS: '0' } as any))
            .toThrow(/between 1 and 168/);
    });
});
