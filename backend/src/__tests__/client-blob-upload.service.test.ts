import { beforeEach, describe, expect, it, vi } from 'vitest';

const resultQueue: any[] = [];
const mocks = vi.hoisted(() => ({
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    deleteFileGeneration: vi.fn(),
    transaction: vi.fn(),
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
        transaction: mocks.transaction,
    },
}));

vi.mock('../services/blob-storage.service.js', () => ({
    blobStorageService: { deleteFileGeneration: mocks.deleteFileGeneration },
}));

const {
    ClientBlobUploadService,
    clientBlobCleanupRetryDelayMs,
    clientBlobClaimTtlMs,
} = await import('../services/client-blob-upload.service.js');

describe('ClientBlobUploadService', () => {
    beforeEach(() => {
        resultQueue.length = 0;
        vi.clearAllMocks();
        mocks.insert.mockImplementation(() => chain());
        mocks.select.mockImplementation(() => chain());
        mocks.update.mockImplementation(() => chain());
        mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
            select: mocks.select,
            update: mocks.update,
        }));
        mocks.deleteFileGeneration.mockResolvedValue(true);
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

    it.each(['pending', 'claimed', 'release_cleanup', 'cleanup_started', 'deleted'])(
        'treats exact Eventarc redelivery after %s as a duplicate without mutation',
        async (status) => {
            const uploadId = '11111111-1111-4111-8111-111111111111';
            const uploadedBy = '22222222-2222-4222-8222-222222222222';
            const pathname = `surat-masuk/${uploadedBy}/${uploadId}-arsip.pdf`;
            const existing = {
                id: uploadId,
                provider: 'gcs',
                bucket: 'simsa-upload',
                pathname,
                purpose: 'surat_masuk',
                uploadedBy,
                blobUrl: `gs://simsa-upload/${pathname}`,
                expectedSizeBytes: 1024,
                expectedContentType: 'application/pdf',
                objectGeneration: '1735689600123456',
                eventId: 'original-event',
                status,
                expiresAt: new Date('2026-08-29T00:00:00.000Z'),
            };
            resultQueue.push([existing]);

            const service = new ClientBlobUploadService();
            await expect(service.recordGcsFinalized({
                eventId: 'redelivered-event',
                uploadId,
                bucket: 'simsa-upload',
                pathname,
                generation: existing.objectGeneration,
                // The immutable identity still wins if auxiliary metadata on
                // a late redelivery is not byte-for-byte identical.
                sizeBytes: status === 'claimed' ? 2048 : 1024,
                contentType: status === 'claimed' ? 'application/octet-stream' : 'application/pdf',
                uploadedBy,
                purpose: 'surat_masuk',
            })).resolves.toEqual({ upload: existing, disposition: 'duplicate' });
            expect(mocks.update).not.toHaveBeenCalled();
            expect(mocks.deleteFileGeneration).not.toHaveBeenCalled();
        },
    );

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
        expect(mocks.deleteFileGeneration).toHaveBeenCalledOnce();
        expect(mocks.deleteFileGeneration).toHaveBeenCalledWith(candidate.blobUrl, null);
    });

    it('reconciles a promoted GCS source using its exact immutable generation', async () => {
        const candidate = {
            id: 'lease-released',
            blobUrl: 'gs://simsa-upload/surat-masuk/object.pdf',
            provider: 'gcs',
            objectGeneration: '1735689600123456',
            status: 'release_cleanup',
            cleanupPreviousStatus: null,
        };
        resultQueue.push(
            [candidate],
            [{ ...candidate, status: 'cleanup_started', cleanupPreviousStatus: 'release_cleanup' }],
            [],
        );

        const service = new ClientBlobUploadService();
        await expect(service.cleanupExpired()).resolves.toEqual({
            examined: 1,
            deleted: 1,
            failed: 0,
        });
        expect(mocks.deleteFileGeneration).toHaveBeenCalledWith(
            candidate.blobUrl,
            candidate.objectGeneration,
        );
    });

    it('tombstones an expired GCS authorization without deleting a live object name', async () => {
        const candidate = {
            id: 'authorized-without-generation',
            blobUrl: 'gs://simsa-upload/surat-masuk/late-finalize.pdf',
            provider: 'gcs',
            objectGeneration: null,
            status: 'authorized',
            cleanupPreviousStatus: null,
            expiresAt: new Date('2026-08-27T00:00:00.000Z'),
        };
        resultQueue.push(
            [candidate],
            [{ ...candidate, status: 'cleanup_started', cleanupPreviousStatus: 'authorized' }],
            [],
        );

        const service = new ClientBlobUploadService();
        await expect(service.cleanupExpired(1, new Date('2026-08-28T00:00:00.000Z')))
            .resolves.toEqual({ examined: 1, deleted: 1, failed: 0 });
        expect(mocks.deleteFileGeneration).not.toHaveBeenCalled();
    });

    it('backs off failed cleanup rows and continues with another orphan in the same batch', async () => {
        const failed = {
            id: 'failed-orphan',
            blobUrl: 'gs://simsa-upload/surat-masuk/failed.pdf',
            provider: 'gcs',
            objectGeneration: '1',
            status: 'release_cleanup',
            cleanupPreviousStatus: null,
        };
        const healthy = {
            id: 'healthy-orphan',
            blobUrl: 'gs://simsa-upload/surat-masuk/healthy.pdf',
            provider: 'gcs',
            objectGeneration: '2',
            status: 'release_cleanup',
            cleanupPreviousStatus: null,
        };
        resultQueue.push(
            [failed, healthy],
            [{ ...failed, status: 'cleanup_started', cleanupPreviousStatus: 'release_cleanup' }],
            [],
            [{ ...healthy, status: 'cleanup_started', cleanupPreviousStatus: 'release_cleanup' }],
            [],
        );
        mocks.deleteFileGeneration.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

        const service = new ClientBlobUploadService();
        await expect(service.cleanupExpired(2)).resolves.toEqual({
            examined: 2,
            deleted: 1,
            failed: 1,
        });
        expect(mocks.deleteFileGeneration).toHaveBeenNthCalledWith(1, failed.blobUrl, '1');
        expect(mocks.deleteFileGeneration).toHaveBeenNthCalledWith(2, healthy.blobUrl, '2');
        expect(clientBlobCleanupRetryDelayMs(1)).toBe(60_000);
        expect(clientBlobCleanupRetryDelayMs(2)).toBe(120_000);
        expect(clientBlobCleanupRetryDelayMs(20)).toBe(3_600_000);
    });

    it('validates the configured expiry window', () => {
        expect(clientBlobClaimTtlMs({ CLIENT_BLOB_UPLOAD_TTL_HOURS: '24' } as any))
            .toBe(24 * 60 * 60 * 1000);
        expect(() => clientBlobClaimTtlMs({ CLIENT_BLOB_UPLOAD_TTL_HOURS: '0' } as any))
            .toThrow(/between 1 and 168/);
    });
});
