import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
    deleteVercel: vi.fn(),
    listVercel: vi.fn(),
    uploadVercel: vi.fn(),
}));

vi.mock('../storage/vercel-blob.adapter.js', () => ({
    VercelBlobAdapter: class MockVercelBlobAdapter {
        readonly provider = 'vercel-blob' as const;
        accepts(locator: string) {
            return locator.startsWith('https://');
        }
        deleteFile(locator: string) {
            return storage.deleteVercel(locator);
        }
        listFiles(prefix: string, options: unknown) {
            return storage.listVercel(prefix, options);
        }
        uploadFile(options: unknown) {
            return storage.uploadVercel(options);
        }
    },
}));

const { BlobStorageService } = await import('../services/blob-storage.service.js');

const blobLocator = 'https://store.private.blob.vercel-storage.com/surat-masuk/scan.pdf';

describe('BlobStorageService on private Vercel Blob', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllEnvs();
        storage.deleteVercel.mockResolvedValue(true);
        storage.listVercel.mockResolvedValue([]);
        storage.uploadVercel.mockResolvedValue({ url: blobLocator });
    });

    it('fails closed with a clear reason for a stored Cloud Storage locator', async () => {
        const service = new BlobStorageService();

        expect(() => service.deleteFileGeneration('gs://simsa-final/final.pdf', '2'))
            .toThrow(/Cloud Storage \(gs:\/\/\) locators are not supported/);
        expect(() => service.downloadFile('gs://simsa-final/final.pdf'))
            .toThrow(/Cloud Storage \(gs:\/\/\) locators are not supported/);
        expect(() => service.deleteFile('ftp://example.test/file.pdf'))
            .toThrow('Unsupported object-storage locator');
        expect(storage.deleteVercel).not.toHaveBeenCalled();
    });

    it('deletes an immutable Blob URL regardless of the recorded generation', async () => {
        const service = new BlobStorageService();

        await expect(service.deleteFileGeneration(blobLocator, null)).resolves.toBe(true);
        expect(storage.deleteVercel).toHaveBeenCalledExactlyOnceWith(blobLocator);
    });

    it('stores untrusted server bytes in the same private Blob store', async () => {
        const service = new BlobStorageService();
        const upload = { fileName: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') };

        await expect(service.uploadUntrustedFile(upload)).resolves.toEqual({ url: blobLocator });
        expect(storage.uploadVercel).toHaveBeenCalledExactlyOnceWith(upload);
    });

    it('retains the bounded prefix probe for Vercel Blob', async () => {
        const signal = new AbortController().signal;
        const service = new BlobStorageService();

        await expect(service.probeConnectivity({ abortSignal: signal })).resolves.toBeUndefined();
        expect(storage.listVercel).toHaveBeenCalledWith(
            '__simsa_readiness_probe__/',
            { abortSignal: signal },
        );
    });
});
