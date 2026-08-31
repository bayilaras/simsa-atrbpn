import { buildCloudPlatformConfig } from '../config/cloud-platform.js';
import { GcsStorageAdapter } from '../storage/gcs.adapter.js';
import { parseGcsLocator } from '../storage/locator.js';
import type {
    CopyFileOptions,
    DownloadFileOptions,
    GetFileOptions,
    ObjectStorageAdapter,
    StoredFile,
    UploadFileOptions,
} from '../storage/types.js';
import { VercelBlobAdapter } from '../storage/vercel-blob.adapter.js';

export type {
    CopyFileOptions,
    DownloadFileOptions,
    StoredFile,
    UploadFileOptions,
} from '../storage/types.js';

const MAX_CROSS_PROVIDER_COPY_BYTES = 64 * 1024 * 1024;

async function streamToBuffer(stream: NodeJS.ReadableStream, maximumBytes: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const value of stream as AsyncIterable<Buffer | Uint8Array | string>) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        total += chunk.length;
        if (total > maximumBytes) {
            throw new Error(`Cross-provider copy exceeds ${maximumBytes} bytes`);
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
}

/**
 * Compatibility facade retained under the old name while storage moves from
 * Vercel Blob to private Cloud Storage. Domain code treats every URL as an
 * opaque locator and authorized downloads still pass through the API.
 */
export class BlobStorageService {
    private readonly vercel = new VercelBlobAdapter();
    private gcsKey = '';
    private gcs?: GcsStorageAdapter;
    private gcsUploadKey = '';
    private gcsUpload?: GcsStorageAdapter;

    private gcsAdapter(source: NodeJS.ProcessEnv = process.env): GcsStorageAdapter {
        const config = buildCloudPlatformConfig(source);
        const key = `${config.projectId}:${config.gcsBucket}`;
        if (!this.gcs || this.gcsKey !== key) {
            this.gcs = GcsStorageAdapter.fromEnvironment(source);
            this.gcsKey = key;
        }
        return this.gcs;
    }

    private primary(): ObjectStorageAdapter {
        const config = buildCloudPlatformConfig();
        return config.storageProvider === 'gcs' ? this.gcsAdapter() : this.vercel;
    }

    private untrustedUploadTarget(): ObjectStorageAdapter {
        const config = buildCloudPlatformConfig();
        if (config.storageProvider !== 'gcs') return this.vercel;

        const key = `${config.projectId}:${config.gcsUploadBucket}`;
        if (!this.gcsUpload || this.gcsUploadKey !== key) {
            this.gcsUpload = GcsStorageAdapter.uploadFromEnvironment();
            this.gcsUploadKey = key;
        }
        return this.gcsUpload;
    }

    private adapterFor(locator: string): ObjectStorageAdapter {
        if (this.vercel.accepts(locator)) return this.vercel;
        if (locator.startsWith('gs://')) {
            const parsed = parseGcsLocator(locator);
            const config = buildCloudPlatformConfig();
            if (![config.gcsBucket, config.gcsUploadBucket].includes(parsed.bucket)) {
                throw new Error('Cloud Storage locator is outside the configured environment buckets');
            }
            return this.gcsAdapter({ ...process.env, OBJECT_STORAGE_PROVIDER: 'gcs' });
        }
        throw new Error('Unsupported object-storage locator');
    }

    uploadFile(options: UploadFileOptions): Promise<StoredFile> {
        return this.primary().uploadFile(options);
    }

    /**
     * Store browser/server supplied bytes in quarantine until malware and
     * fixity controls atomically release one immutable generation.
     */
    uploadUntrustedFile(options: UploadFileOptions): Promise<StoredFile> {
        return this.untrustedUploadTarget().uploadFile(options);
    }

    async copyFile(options: CopyFileOptions): Promise<StoredFile> {
        const primary = this.primary();
        const source = this.adapterFor(options.sourceUrl);
        if (primary.provider === source.provider) return primary.copyFile(options);

        const downloaded = await source.downloadFile(options.sourceUrl, {
            throwOnError: true,
            generation: options.sourceGeneration,
        });
        if (!downloaded) throw new Error('Source object does not exist');
        const buffer = await streamToBuffer(downloaded.stream, MAX_CROSS_PROVIDER_COPY_BYTES);
        return primary.uploadFile({
            fileName: options.fileName,
            mimeType: options.mimeType || downloaded.mimeType,
            folder: options.folder,
            buffer,
        });
    }

    getFile(locator: string, options: GetFileOptions = {}): Promise<StoredFile | null> {
        return this.adapterFor(locator).getFile(locator, options);
    }

    deleteFile(locator: string): Promise<boolean> {
        const adapter = this.adapterFor(locator);
        if (adapter.provider === 'gcs') {
            throw new Error('Cloud Storage deletion requires deleteFileGeneration with an immutable generation');
        }
        return adapter.deleteFile(locator);
    }

    deleteFileGeneration(locator: string, generation?: string | null): Promise<boolean> {
        const adapter = this.adapterFor(locator);
        if (adapter.provider === 'gcs') {
            if (!generation) {
                throw new Error('Cloud Storage deletion requires an immutable object generation');
            }
            return (adapter as GcsStorageAdapter).deleteObjectGeneration(locator, generation);
        }
        return adapter.deleteFile(locator);
    }

    downloadFile(locator: string, options: DownloadFileOptions = {}) {
        return this.adapterFor(locator).downloadFile(locator, options);
    }

    async probeConnectivity(options: { abortSignal?: AbortSignal } = {}): Promise<void> {
        const primary = this.primary();
        if (primary.provider === 'gcs') {
            // Prove both buckets and the effective IAM boundary. Merely reading
            // final-bucket metadata let a deployment pass /ready while direct
            // upload was broken, and it could not detect an inherited broad
            // role that added object enumeration or final-object deletion.
            const final = primary as GcsStorageAdapter;
            const quarantine = this.untrustedUploadTarget() as GcsStorageAdapter;
            await Promise.all([
                final.probeAccessContract({
                    required: ['storage.objects.create', 'storage.objects.get'],
                    forbidden: [
                        'storage.buckets.get',
                        'storage.objects.delete',
                        'storage.objects.list',
                        'storage.objects.update',
                    ],
                }, options),
                quarantine.probeAccessContract({
                    required: [
                        'storage.objects.create',
                        'storage.objects.delete',
                        'storage.objects.get',
                    ],
                    forbidden: [
                        'storage.buckets.get',
                        'storage.objects.list',
                        'storage.objects.update',
                    ],
                }, options),
            ]);
            return;
        }
        // Vercel Blob has no bucket-metadata API; retain the bounded private
        // prefix probe for that provider only.
        await primary.listFiles('__simsa_readiness_probe__/', options);
    }

    listFiles(prefix?: string, options: { abortSignal?: AbortSignal } = {}) {
        return this.primary().listFiles(prefix, options);
    }
}

export const blobStorageService = new BlobStorageService();
export const objectStorageService = blobStorageService;
export default blobStorageService;
