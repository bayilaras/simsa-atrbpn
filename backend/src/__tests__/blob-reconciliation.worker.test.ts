import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    assertEnvironment: vi.fn(),
    validateTtl: vi.fn(),
    cleanupClient: vi.fn(),
    cleanupBulk: vi.fn(),
    poolEnd: vi.fn(),
    info: vi.fn(),
    fatal: vi.fn(),
}));

vi.mock('../config/blob-storage.js', () => ({
    assertValidBlobStorageEnvironment: mocks.assertEnvironment,
}));
vi.mock('../config/database.js', () => ({
    pool: { end: mocks.poolEnd },
    db: {},
}));
vi.mock('../services/client-blob-upload.service.js', () => ({
    clientBlobClaimTtlMs: mocks.validateTtl,
    clientBlobUploadService: { cleanupExpired: mocks.cleanupClient },
}));
vi.mock('../services/bulk-upload.service.js', () => ({
    bulkUploadService: { cleanupOldBatches: mocks.cleanupBulk },
}));
vi.mock('../utils/logger.js', () => ({
    createLogger: () => ({ info: mocks.info, fatal: mocks.fatal }),
}));

const worker = await import('../workers/blob-reconciliation.js');
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalExitCode = process.exitCode;

describe('Blob reconciliation worker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.DATABASE_URL = 'postgres://worker.test/database';
        process.exitCode = undefined;
        mocks.cleanupClient.mockResolvedValue({ examined: 2, deleted: 2, failed: 0 });
        mocks.cleanupBulk.mockResolvedValue({
            batchesExpired: 1,
            blobsDeleted: 1,
            blobsFailed: 0,
            blobsProtected: 1,
        });
    });

    afterEach(() => {
        if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = originalDatabaseUrl;
        process.exitCode = originalExitCode;
    });

    it('runs both durable cleanup authorities and exposes their result', async () => {
        const result = await worker.runBlobReconciliation();

        expect(result).toEqual({
            clientUploads: { examined: 2, deleted: 2, failed: 0 },
            bulkUploads: {
                batchesExpired: 1,
                blobsDeleted: 1,
                blobsFailed: 0,
                blobsProtected: 1,
            },
        });
        expect(mocks.cleanupClient).toHaveBeenCalledOnce();
        expect(mocks.cleanupBulk).toHaveBeenCalledOnce();
        expect(worker.hasBlobReconciliationFailures(result)).toBe(false);
    });

    it('sets a non-zero exit code when a retryable Blob deletion fails', async () => {
        mocks.cleanupBulk.mockResolvedValueOnce({
            batchesExpired: 1,
            blobsDeleted: 0,
            blobsFailed: 1,
            blobsProtected: 0,
        });

        await worker.main();

        expect(process.exitCode).toBe(1);
        expect(mocks.poolEnd).toHaveBeenCalledOnce();
        expect(mocks.info).toHaveBeenCalledWith(
            expect.objectContaining({ bulkUploads: expect.objectContaining({ blobsFailed: 1 }) }),
            'Blob reconciliation run completed',
        );
    });
});
