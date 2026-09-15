import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const resultQueue: any[] = [];
const mocks = vi.hoisted(() => ({
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    deleteFileGeneration: vi.fn(),
    transaction: vi.fn(),
    where: vi.fn(),
}));

function chain(): any {
    return new Proxy({}, {
        get(_target, property) {
            if (property === 'where') return (predicate: unknown) => { mocks.where(predicate); return chain(); };
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
        vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_store_synthetic');
    });
    afterEach(() => vi.unstubAllEnvs());

    const readinessNow = new Date('2026-09-13T09:05:15.223Z');
    const readinessClaim = {
        blobUrl: 'https://store.private.blob.vercel-storage.com/surat-masuk/receipt-random.pdf',
        purpose: 'surat_masuk' as const,
        uploadedBy: '11111111-1111-4111-8111-111111111111',
    };
    it('waits before callback commit and becomes ready without claiming or fetching the object', async () => {
        const service = new ClientBlobUploadService();
        resultQueue.push([], [{ status: 'pending', expiresAt: new Date(readinessNow.getTime() + 86_400_000) }]);
        await expect(service.getReadiness(readinessClaim, readinessNow)).resolves.toEqual({ status: 'waiting' });
        await expect(service.getReadiness(readinessClaim, readinessNow)).resolves.toEqual({
            status: 'ready', expiresAt: '2026-09-14T09:05:15.223Z',
        });
        expect(mocks.insert).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.transaction).not.toHaveBeenCalled();
        expect(mocks.deleteFileGeneration).not.toHaveBeenCalled();
    });

    it('queries only the exact normalized URL, purpose, owner and Vercel provider without exposing another lease', async () => {
        resultQueue.push([]);
        const claim = { ...readinessClaim, blobUrl: 'blob:' + readinessClaim.blobUrl };
        await expect(new ClientBlobUploadService().getReadiness(claim, readinessNow)).resolves.toEqual({ status: 'waiting' });
        const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
        expect(query.params).toEqual([readinessClaim.blobUrl, readinessClaim.purpose, readinessClaim.uploadedBy, 'vercel_blob']);
        for (const field of ['blob_url', 'purpose', 'uploaded_by', 'provider']) expect(query.sql).toContain(`"client_blob_uploads"."${field}" =`);
    });

    it('accepts a canonical URL-encoded filename containing spaces and parentheses without changing its immutable URL', async () => {
        const blobUrl = 'https://store.private.blob.vercel-storage.com/surat-masuk/58%20UND%20(26%20Agustus%202026)_TTE-random.pdf';
        resultQueue.push([{ status: 'pending', expiresAt: new Date(readinessNow.getTime() + 86_400_000) }]);
        await expect(new ClientBlobUploadService().getReadiness({ ...readinessClaim, blobUrl }, readinessNow))
            .resolves.toMatchObject({ status: 'ready' });
        expect(new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]).params[0]).toBe(blobUrl);
    });

    it.each(['authorized', 'claimed', 'cleanup_started', 'release_cleanup', 'deleted'])(
        'does not report an owned %s lease as ready', async status => {
            resultQueue.push([{ status, expiresAt: new Date(readinessNow.getTime() + 86_400_000) }]);
            await expect(new ClientBlobUploadService().getReadiness(readinessClaim, readinessNow)).resolves.toEqual({ status: 'unavailable' });
        },
    );

    it.each([[-1, 'unavailable'], [0, 'unavailable'], [1, 'ready']] as const)(
        'enforces the letter preflight margin at boundary offset %i ms', async (offset, status) => {
            resultQueue.push([{ status: 'pending', expiresAt: new Date(readinessNow.getTime() + 35_000 + offset) }]);
            await expect(new ClientBlobUploadService().getReadiness(readinessClaim, readinessNow)).resolves.toMatchObject({ status });
        },
    );

    it('reserves the existing ten-minute regulatory PDF preflight window', async () => {
        const claim = { ...readinessClaim, purpose: 'regulatory_source' as const,
            blobUrl: 'https://store.private.blob.vercel-storage.com/regulatory-sources/22222222-2222-4222-8222-222222222222/source.pdf' };
        resultQueue.push([{ status: 'pending', expiresAt: new Date(readinessNow.getTime() + 600_000) }],
            [{ status: 'pending', expiresAt: new Date(readinessNow.getTime() + 600_001) }]);
        await expect(new ClientBlobUploadService().getReadiness(claim, readinessNow)).resolves.toEqual({ status: 'unavailable' });
        await expect(new ClientBlobUploadService().getReadiness(claim, readinessNow)).resolves.toMatchObject({ status: 'ready' });
    });

    it.each([
        'https://other.private.blob.vercel-storage.com/surat-masuk/file.pdf',
        'https://store.public.blob.vercel-storage.com/surat-masuk/file.pdf',
        'http://store.private.blob.vercel-storage.com/surat-masuk/file.pdf',
        'https://store.private.blob.vercel-storage.com:444/surat-masuk/file.pdf',
        'https://name@store.private.blob.vercel-storage.com/surat-masuk/file.pdf',
        'https://store.private.blob.vercel-storage.com/surat-masuk/file.pdf?token=private',
        'https://store.private.blob.vercel-storage.com/surat-masuk/file.pdf#fragment',
        'https://store.private.blob.vercel-storage.com/surat-keluar/file.pdf',
        'https://store.private.blob.vercel-storage.com/surat-masuk/file.txt',
        'https://store.private.blob.vercel-storage.com/surat-masuk/%00file.pdf',
    ])('rejects an untrusted or cross-purpose readiness locator before any query: %s', async blobUrl => {
        await expect(new ClientBlobUploadService().getReadiness({ ...readinessClaim, blobUrl }, readinessNow)).rejects.toMatchObject({ statusCode: 400 });
        expect(mocks.select).not.toHaveBeenCalled();
    });

    it('fails closed for missing storage configuration and database failures', async () => {
        vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
        await expect(new ClientBlobUploadService().getReadiness(readinessClaim, readinessNow)).rejects.toThrow(/not configured/);
        expect(mocks.select).not.toHaveBeenCalled();
        vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_store_synthetic');
        mocks.select.mockImplementationOnce(() => { throw new Error('database offline'); });
        await expect(new ClientBlobUploadService().getReadiness(readinessClaim, readinessNow)).rejects.toThrow('database offline');
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
