import { copy, del, get, head, list, put } from '@vercel/blob';
import { Readable } from 'node:stream';
import { buildBlobStorageConfig } from '../config/blob-storage.js';
import { createLogger } from '../utils/logger.js';
import { isVercelBlobLocator } from './locator.js';
import type {
    CopyFileOptions,
    DownloadFileOptions,
    GetFileOptions,
    ObjectStorageAdapter,
    StoredFile,
    UploadFileOptions,
} from './types.js';

const log = createLogger('VercelBlobAdapter');

export class VercelBlobAdapter implements ObjectStorageAdapter {
    readonly provider = 'vercel-blob' as const;

    accepts(locator: string): boolean {
        return isVercelBlobLocator(locator);
    }

    private assertConfigured(): void {
        const status = buildBlobStorageConfig(process.env, { requireCallbackUrl: false });
        if (!status.ready) {
            throw new Error(
                status.validationErrors[0]
                || 'Private Blob storage is not configured (BLOB_READ_WRITE_TOKEN missing)',
            );
        }
    }

    async uploadFile(options: UploadFileOptions): Promise<StoredFile> {
        this.assertConfigured();
        const pathname = options.folder
            ? `${options.folder}/${options.fileName}`
            : `uploads/${options.fileName}`;
        const blob = await put(pathname, options.buffer, {
            access: 'private',
            contentType: options.mimeType,
            addRandomSuffix: true,
        });
        return {
            id: blob.url,
            name: options.fileName,
            mimeType: options.mimeType,
            url: blob.url,
            downloadUrl: blob.downloadUrl,
            size: options.buffer.length,
        };
    }

    async copyFile(options: CopyFileOptions): Promise<StoredFile> {
        this.assertConfigured();
        if (!this.accepts(options.sourceUrl)) {
            throw new Error('Vercel Blob cannot server-side copy a non-Vercel locator');
        }
        const pathname = `${options.folder}/${options.fileName}`;
        const blob = await copy(options.sourceUrl, pathname, {
            access: 'private',
            contentType: options.mimeType,
            addRandomSuffix: true,
            allowOverwrite: false,
        });
        const metadata = await head(blob.url);
        return {
            id: blob.url,
            name: options.fileName,
            mimeType: blob.contentType || options.mimeType,
            url: blob.url,
            downloadUrl: blob.downloadUrl,
            size: metadata.size,
        };
    }

    async getFile(locator: string, _options: GetFileOptions = {}): Promise<StoredFile | null> {
        try {
            this.assertConfigured();
            if (!this.accepts(locator)) throw new Error('Invalid Vercel Blob locator');
            const metadata = await head(locator);
            return {
                id: metadata.url,
                name: metadata.pathname.split('/').pop() || 'unknown',
                mimeType: metadata.contentType,
                url: metadata.url,
                downloadUrl: metadata.downloadUrl,
                size: metadata.size,
            };
        } catch (error) {
            if ((error as { name?: string }).name === 'BlobNotFoundError') return null;
            log.error({ err: error, locator }, 'Failed to read Vercel Blob metadata');
            return null;
        }
    }

    async deleteFile(locator: string): Promise<boolean> {
        try {
            this.assertConfigured();
            if (!this.accepts(locator)) throw new Error('Invalid Vercel Blob locator');
            await del(locator);
            return true;
        } catch (error) {
            log.error({ err: error, locator }, 'Failed to delete Vercel Blob object');
            return false;
        }
    }

    async downloadFile(
        locator: string,
        options: DownloadFileOptions = {},
    ): Promise<{ stream: Readable; mimeType: string; fileName: string } | null> {
        try {
            this.assertConfigured();
            if (!this.accepts(locator)) throw new Error('Invalid Vercel Blob locator');
            const parsed = new URL(locator.startsWith('blob:') ? locator.slice(5) : locator);
            const access = parsed.hostname.includes('.private.blob.vercel-storage.com')
                ? 'private'
                : 'public';
            const result = await get(parsed.toString(), {
                access,
                useCache: false,
                ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
            });
            if (!result) return null;
            if (result.statusCode !== 200 || !result.stream) {
                throw new Error('Blob returned an unexpected response without content');
            }
            return {
                stream: Readable.fromWeb(result.stream as any),
                mimeType: result.blob.contentType || 'application/octet-stream',
                fileName: result.blob.pathname.split('/').pop() || 'download',
            };
        } catch (error) {
            if ((error as { name?: string }).name === 'BlobNotFoundError') return null;
            log.error({ err: error, locator }, 'Failed to download Vercel Blob object');
            if (options.throwOnError) throw error;
            return null;
        }
    }

    async listFiles(
        prefix = 'uploads/',
        options: { abortSignal?: AbortSignal } = {},
    ): Promise<StoredFile[]> {
        this.assertConfigured();
        const result = await list({
            prefix,
            limit: 100,
            ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
        });
        return result.blobs.map(blob => ({
            id: blob.url,
            name: blob.pathname.split('/').pop() || 'unknown',
            mimeType: 'application/octet-stream',
            url: blob.url,
            downloadUrl: blob.downloadUrl,
            size: blob.size,
        }));
    }
}
