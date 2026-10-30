import { assertObjectStorageAvailable } from '../config/blob-storage.js';
import type {
    CopyFileOptions,
    DownloadFileOptions,
    GetFileOptions,
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

/**
 * Private Vercel Blob facade. Domain code treats every URL as an opaque
 * locator and authorized downloads still pass through the API.
 */
export class BlobStorageService {
    private readonly vercel = new VercelBlobAdapter();

    private primary(): VercelBlobAdapter {
        assertObjectStorageAvailable();
        return this.vercel;
    }

    private adapterFor(locator: string): VercelBlobAdapter {
        assertObjectStorageAvailable();
        if (this.vercel.accepts(locator)) return this.vercel;
        if (locator.startsWith('gs://')) {
            // Production never stored objects in Cloud Storage; fail closed
            // with a clear reason if such a locator is ever read back.
            throw new Error('Cloud Storage (gs://) locators are not supported; objects are stored in private Vercel Blob only');
        }
        throw new Error('Unsupported object-storage locator');
    }

    uploadFile(options: UploadFileOptions): Promise<StoredFile> {
        return this.primary().uploadFile(options);
    }

    /**
     * Store browser/server supplied bytes in quarantine until malware and
     * fixity controls release them.
     */
    uploadUntrustedFile(options: UploadFileOptions): Promise<StoredFile> {
        return this.primary().uploadFile(options);
    }

    getUntrustedFileByName(objectName: string): Promise<StoredFile | null> {
        return this.primary().getFileByReservedName(objectName);
    }

    async copyFile(options: CopyFileOptions): Promise<StoredFile> {
        const primary = this.primary();
        this.adapterFor(options.sourceUrl);
        return primary.copyFile(options);
    }

    getFile(locator: string, options: GetFileOptions = {}): Promise<StoredFile | null> {
        return this.adapterFor(locator).getFile(locator, options);
    }

    deleteFile(locator: string): Promise<boolean> {
        return this.adapterFor(locator).deleteFile(locator);
    }

    /** Blob URLs are immutable, so the recorded generation (always null) is not needed. */
    deleteFileGeneration(locator: string, _generation?: string | null): Promise<boolean> {
        return this.adapterFor(locator).deleteFile(locator);
    }

    downloadFile(locator: string, options: DownloadFileOptions = {}) {
        return this.adapterFor(locator).downloadFile(locator, options);
    }

    async probeConnectivity(options: { abortSignal?: AbortSignal } = {}): Promise<void> {
        // Vercel Blob has no bucket-metadata API; use a bounded private prefix probe.
        await this.primary().listFiles('__simsa_readiness_probe__/', options);
    }

    listFiles(prefix?: string, options: { abortSignal?: AbortSignal } = {}) {
        return this.primary().listFiles(prefix, options);
    }
}

export const blobStorageService = new BlobStorageService();
export const objectStorageService = blobStorageService;
export default blobStorageService;
