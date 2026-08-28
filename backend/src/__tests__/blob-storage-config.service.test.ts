import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
    get: vi.fn(),
    list: vi.fn(),
}));

vi.mock('@vercel/blob', () => ({
    put: vi.fn(),
    del: vi.fn(),
    get: sdk.get,
    head: vi.fn(),
    copy: vi.fn(),
    list: sdk.list,
}));

const { BlobStorageService } = await import('../services/blob-storage.service.js');

describe('BlobStorageService data-plane configuration', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it('allows a production worker to use Blob without the API callback origin', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_worker_test_value');
        vi.stubEnv('VERCEL_BLOB_CALLBACK_URL', '');
        sdk.list.mockResolvedValue({ blobs: [] });

        await expect(new BlobStorageService().listFiles('worker-probe/')).resolves.toEqual([]);
        expect(sdk.list).toHaveBeenCalledWith({ prefix: 'worker-probe/', limit: 100 });
    });

    it('still fails closed when the data-plane token is absent', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
        vi.stubEnv('VERCEL_BLOB_CALLBACK_URL', '');

        await expect(new BlobStorageService().listFiles('worker-probe/'))
            .rejects.toThrow('BLOB_READ_WRITE_TOKEN');
        expect(sdk.list).not.toHaveBeenCalled();
    });

    it('keeps a missing object distinct from transient provider failures', async () => {
        vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_worker_test_value');
        const service = new BlobStorageService();
        const locator = 'https://store.private.blob.vercel-storage.com/surat-masuk/missing.pdf';

        sdk.get.mockResolvedValueOnce(null);
        await expect(service.downloadFile(locator, { throwOnError: true })).resolves.toBeNull();

        sdk.get.mockRejectedValueOnce(new Error('provider unavailable'));
        await expect(service.downloadFile(locator, { throwOnError: true }))
            .rejects.toThrow('provider unavailable');
    });
});
