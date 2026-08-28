import { put, del, get, head, list, copy } from '@vercel/blob';
import { Readable } from 'stream';
import { createLogger } from '../utils/logger';

const log = createLogger('BlobStorageService');

export interface UploadFileOptions {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    folder?: string;
}

export interface CopyFileOptions {
    sourceUrl: string;
    fileName: string;
    mimeType: string;
    folder: string;
}

export interface StoredFile {
    id: string;       // The blob URL (used as ID)
    name: string;
    mimeType: string;
    url: string;       // Internal object locator; never expose it as an access grant.
    downloadUrl: string;
    size?: number;
}

export class BlobStorageService {
    // Upload file to Vercel Blob
    async uploadFile(options: UploadFileOptions): Promise<StoredFile> {
        const { fileName, mimeType, buffer, folder } = options;

        // Use folder prefix for organization
        const pathname = folder ? `${folder}/${fileName}` : `uploads/${fileName}`;

        log.info({ fileName, mimeType, bufferSize: buffer.length, pathname }, 'Uploading file to Vercel Blob');

        const blob = await put(pathname, buffer, {
            // Government records must not be reachable with an unauthenticated
            // object URL. Application routes authenticate, authorize and audit
            // every read before proxying this private stream.
            access: 'private',
            contentType: mimeType,
            addRandomSuffix: true, // Prevents filename conflicts
        });

        log.info({ url: blob.url, pathname: blob.pathname }, 'File uploaded to Vercel Blob');

        return {
            id: blob.url,        // URL is the unique identifier
            name: fileName,
            mimeType: mimeType,
            url: blob.url,
            downloadUrl: blob.downloadUrl,
            size: buffer.length,
        };
    }

    // Copy an already-private immutable object into a new namespace.  Vercel
    // performs this inside the backing store, avoiding a server round trip for
    // large regulatory PDFs while retaining a rule-set-bound locator.
    async copyFile(options: CopyFileOptions): Promise<StoredFile> {
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

    // Get file metadata
    async getFile(blobUrl: string): Promise<StoredFile | null> {
        try {
            const metadata = await head(blobUrl);
            return {
                id: metadata.url,
                name: metadata.pathname.split('/').pop() || 'unknown',
                mimeType: metadata.contentType,
                url: metadata.url,
                downloadUrl: metadata.downloadUrl,
                size: metadata.size,
            };
        } catch (error) {
            log.error({ err: error, blobUrl }, 'Failed to get file metadata');
            return null;
        }
    }

    // Delete file from Vercel Blob
    async deleteFile(blobUrl: string): Promise<boolean> {
        try {
            await del(blobUrl);
            log.info({ blobUrl }, 'File deleted from Vercel Blob');
            return true;
        } catch (error) {
            log.error({ err: error, blobUrl }, 'Failed to delete file');
            return false;
        }
    }

    // Download file content as a readable stream
    async downloadFile(blobUrl: string): Promise<{ stream: Readable; mimeType: string; fileName: string } | null> {
        try {
            const parsedUrl = new URL(blobUrl);
            if (
                parsedUrl.protocol !== 'https:' ||
                !parsedUrl.hostname.endsWith('.blob.vercel-storage.com')
            ) {
                throw new Error('Refusing to retrieve a non-Vercel object URL');
            }

            // New objects are private. The public mode is retained solely so
            // legacy objects can be migrated without breaking record access.
            const access = parsedUrl.hostname.includes('.private.blob.vercel-storage.com')
                ? 'private'
                : 'public';
            const result = await get(blobUrl, { access, useCache: false });
            if (!result || result.statusCode !== 200 || !result.stream) {
                throw new Error('Blob was not found or returned no content');
            }

            const contentType = result.blob.contentType || 'application/octet-stream';
            const fileName = result.blob.pathname.split('/').pop() || 'download';
            const nodeStream = Readable.fromWeb(result.stream as any);

            return {
                stream: nodeStream,
                mimeType: contentType,
                fileName,
            };
        } catch (error) {
            log.error({ err: error, blobUrl }, 'Failed to download file from Blob');
            return null;
        }
    }

    // List files
    async listFiles(prefix?: string): Promise<StoredFile[]> {
        const result = await list({
            prefix: prefix || 'uploads/',
            limit: 100,
        });

        return result.blobs.map((blob) => ({
            id: blob.url,
            name: blob.pathname.split('/').pop() || 'unknown',
            mimeType: 'application/octet-stream', // list doesn't return content type
            url: blob.url,
            downloadUrl: blob.downloadUrl,
            size: blob.size,
        }));
    }
}

export const blobStorageService = new BlobStorageService();
export default blobStorageService;
