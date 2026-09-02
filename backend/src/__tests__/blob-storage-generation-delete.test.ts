import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
    deleteGeneration: vi.fn(),
    probeAccess: vi.fn(),
    listVercel: vi.fn(),
    provider: 'gcs',
    uploadFinal: vi.fn(),
    uploadQuarantine: vi.fn(),
}));

vi.mock('../config/cloud-platform.js', () => ({
    buildCloudPlatformConfig: () => ({
        storageProvider: storage.provider,
        projectId: 'simsa-test',
        gcsBucket: 'simsa-final',
        gcsUploadBucket: 'simsa-upload',
    }),
}));

vi.mock('../storage/gcs.adapter.js', () => ({
    GcsStorageAdapter: class MockGcsStorageAdapter {
        readonly provider = 'gcs' as const;
        constructor(private readonly target: 'final' | 'quarantine' = 'final') {}
        static fromEnvironment() {
            return new MockGcsStorageAdapter('final');
        }
        static uploadFromEnvironment() {
            return new MockGcsStorageAdapter('quarantine');
        }
        accepts(locator: string) {
            return locator.startsWith('gs://');
        }
        deleteObjectGeneration(locator: string, generation: string) {
            return storage.deleteGeneration(locator, generation);
        }
        probeAccessContract(contract: unknown, options: unknown) {
            return storage.probeAccess(this.target, contract, options);
        }
        uploadFile(options: unknown) {
            return this.target === 'quarantine'
                ? storage.uploadQuarantine(options)
                : storage.uploadFinal(options);
        }
    },
}));

vi.mock('../storage/vercel-blob.adapter.js', () => ({
    VercelBlobAdapter: class MockVercelBlobAdapter {
        readonly provider = 'vercel-blob' as const;
        accepts(locator: string) {
            return locator.startsWith('https://');
        }
        listFiles(prefix: string, options: unknown) {
            return storage.listVercel(prefix, options);
        }
    },
}));

const { BlobStorageService } = await import('../services/blob-storage.service.js');

describe('BlobStorageService exact-generation deletion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        storage.provider = 'gcs';
        storage.deleteGeneration.mockResolvedValue(true);
        storage.probeAccess.mockResolvedValue(undefined);
        storage.listVercel.mockResolvedValue([]);
        storage.uploadFinal.mockResolvedValue({ url: 'gs://simsa-final/final.pdf', generation: '2' });
        storage.uploadQuarantine.mockResolvedValue({
            url: 'gs://simsa-upload/quarantine.pdf',
            generation: '1',
        });
    });

    it('fails closed instead of deleting a live GCS object name', async () => {
        const service = new BlobStorageService();

        expect(() => service.deleteFile(
            'gs://simsa-upload/surat-masuk/record.pdf',
        )).toThrow(/requires deleteFileGeneration with an immutable generation/);
        expect(() => service.deleteFileGeneration(
            'gs://simsa-upload/surat-masuk/record.pdf',
            null,
        )).toThrow(/requires an immutable object generation/);
        expect(storage.deleteGeneration).not.toHaveBeenCalled();
    });

    it('delegates an exact GCS generation delete', async () => {
        const service = new BlobStorageService();
        await expect(service.deleteFileGeneration(
            'gs://simsa-upload/surat-masuk/record.pdf',
            '1735689600123456',
        )).resolves.toBe(true);
        expect(storage.deleteGeneration).toHaveBeenCalledWith(
            'gs://simsa-upload/surat-masuk/record.pdf',
            '1735689600123456',
        );
    });

    it('rejects GCS locators outside this environment even if IAM was accidentally granted', () => {
        const service = new BlobStorageService();

        expect(() => service.deleteFileGeneration(
            'gs://simsa-production-final/released/record.pdf',
            '1735689600123456',
        )).toThrow(/outside the configured environment buckets/);
        expect(storage.deleteGeneration).not.toHaveBeenCalled();
    });

    it('routes untrusted server bytes to the quarantine bucket adapter', async () => {
        const service = new BlobStorageService();
        const options = {
            fileName: 'record.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF'),
        };

        await expect(service.uploadUntrustedFile(options)).resolves.toMatchObject({
            url: 'gs://simsa-upload/quarantine.pdf',
            generation: '1',
        });
        expect(storage.uploadQuarantine).toHaveBeenCalledWith(options);
        expect(storage.uploadFinal).not.toHaveBeenCalled();

        await service.uploadFile(options);
        expect(storage.uploadFinal).toHaveBeenCalledWith(options);
    });

    it('proves exact effective IAM on both GCS buckets without object listing', async () => {
        const signal = new AbortController().signal;
        const service = new BlobStorageService();

        await expect(service.probeConnectivity({ abortSignal: signal })).resolves.toBeUndefined();
        expect(storage.probeAccess).toHaveBeenCalledTimes(2);
        expect(storage.probeAccess).toHaveBeenCalledWith(
            'final',
            {
                required: ['storage.objects.create', 'storage.objects.get'],
                forbidden: [
                    'storage.buckets.get',
                    'storage.objects.delete',
                    'storage.objects.list',
                    'storage.objects.update',
                ],
            },
            { abortSignal: signal },
        );
        expect(storage.probeAccess).toHaveBeenCalledWith(
            'quarantine',
            expect.objectContaining({
                required: expect.arrayContaining([
                    'storage.objects.create',
                    'storage.objects.delete',
                    'storage.objects.get',
                ]),
            }),
            { abortSignal: signal },
        );
        expect(storage.listVercel).not.toHaveBeenCalled();
    });

    it('retains the bounded prefix probe only for Vercel Blob', async () => {
        storage.provider = 'vercel-blob';
        const signal = new AbortController().signal;
        const service = new BlobStorageService();

        await expect(service.probeConnectivity({ abortSignal: signal })).resolves.toBeUndefined();
        expect(storage.listVercel).toHaveBeenCalledWith(
            '__simsa_readiness_probe__/',
            { abortSignal: signal },
        );
        expect(storage.probeAccess).not.toHaveBeenCalled();
    });
});
