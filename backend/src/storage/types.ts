import type { Readable } from 'node:stream';

export interface UploadFileOptions {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    folder?: string;
}

export interface CopyFileOptions {
    sourceUrl: string;
    /** Required when the source is GCS so a copy cannot follow the live name. */
    sourceGeneration?: string;
    fileName: string;
    mimeType: string;
    folder: string;
}

export interface GetFileOptions {
    /** Read metadata for one immutable Cloud Storage generation. */
    generation?: string;
}

export interface StoredFile {
    id: string;
    name: string;
    mimeType: string;
    /** Canonical internal locator. It is never an unauthenticated access grant. */
    url: string;
    /** Compatibility alias. Downloads must continue through an authorized API route. */
    downloadUrl: string;
    size?: number;
    generation?: string;
    /** GCS object timestamps used to respect bucket retention during cleanup. */
    createdAt?: string;
    retentionExpiresAt?: string;
}

export interface DownloadFileOptions {
    abortSignal?: AbortSignal;
    throwOnError?: boolean;
    /** Read one immutable Cloud Storage generation instead of the live object name. */
    generation?: string;
}

export interface ObjectStorageAdapter {
    readonly provider: 'vercel-blob' | 'gcs';
    accepts(locator: string): boolean;
    uploadFile(options: UploadFileOptions): Promise<StoredFile>;
    copyFile(options: CopyFileOptions): Promise<StoredFile>;
    getFile(locator: string, options?: GetFileOptions): Promise<StoredFile | null>;
    deleteFile(locator: string): Promise<boolean>;
    downloadFile(
        locator: string,
        options?: DownloadFileOptions,
    ): Promise<{ stream: Readable; mimeType: string; fileName: string } | null>;
    listFiles(prefix?: string, options?: { abortSignal?: AbortSignal }): Promise<StoredFile[]>;
}
