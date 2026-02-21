import { put, del, head, list } from '@vercel/blob';
import { Readable } from 'stream';
import { createLogger } from '../utils/logger';

const log = createLogger('BlobStorageService');

export interface UploadFileOptions {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    folder?: string;
}

export interface StoredFile {
    id: string;       // The blob URL (used as ID)
    name: string;
    mimeType: string;
    url: string;       // Direct public URL — can be used in <img>, <iframe>, etc.
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
            access: 'public',
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
            // Fetch the file from the public URL
            const response = await fetch(blobUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch blob: ${response.status}`);
            }

            const contentType = response.headers.get('content-type') || 'application/octet-stream';
            const fileName = blobUrl.split('/').pop() || 'download';

            // Convert web ReadableStream to Node.js Readable
            const webStream = response.body;
            if (!webStream) {
                throw new Error('Response body is empty');
            }

            const nodeStream = Readable.fromWeb(webStream as any);

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
