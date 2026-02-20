import { google } from 'googleapis';
import { Readable } from 'stream';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';

const log = createLogger('GoogleDriveService');

// Fix private key: Vercel env vars can mangle PEM keys in many ways
function formatPrivateKey(key: string | undefined): string {
    if (!key) return '';

    // 1. Strip wrapping quotes (single or double)
    let cleaned = key.replace(/^["']|["']$/g, '');

    // 2. Replace literal \n (two chars: backslash + n) with actual newlines
    cleaned = cleaned.replace(/\\n/g, '\n');

    // 3. If there are now real newlines, the key should be valid
    if (cleaned.includes('\n') && cleaned.includes('-----BEGIN')) {
        log.info('Private key: restored via \\n replacement');
        return cleaned;
    }

    // 4. If still no newlines, the key may be completely flattened — reconstruct PEM
    const pemMatch = cleaned.match(/(-----BEGIN [A-Z ]+-----)([\s\S]*?)(-----END [A-Z ]+-----)/);
    if (pemMatch) {
        const header = pemMatch[1];
        const body = pemMatch[2].replace(/\s/g, ''); // strip any spaces
        const footer = pemMatch[3];
        // PEM base64 body must have 64-char lines
        const bodyLines = body.match(/.{1,64}/g) || [];
        const reconstructed = [header, ...bodyLines, footer, ''].join('\n');
        log.info({ headerFound: true, bodyLength: body.length, lineCount: bodyLines.length }, 'Private key: reconstructed PEM from flattened key');
        return reconstructed;
    }

    // 5. Fallback: return as-is and hope for the best
    log.warn('Private key: could not detect PEM structure, using as-is');
    return cleaned;
}

const privateKey = formatPrivateKey(env.GOOGLE_PRIVATE_KEY);

// Log credential availability (NOT the actual values!)
log.info({
    hasServiceEmail: !!env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    hasPrivateKey: !!privateKey,
    privateKeyLength: privateKey?.length || 0,
    keyStartsWith: privateKey?.substring(0, 27) || 'N/A',
    keyEndsWith: privateKey?.substring(privateKey.length - 25) || 'N/A',
    hasFolderId: !!env.GOOGLE_DRIVE_FOLDER_ID,
}, 'Google Drive credentials status');

// Initialize Google Drive API with service account
const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/drive.file'],
});

const drive = google.drive({ version: 'v3', auth });

export interface UploadFileOptions {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    folderId?: string;
}

export interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    webViewLink: string;
    webContentLink?: string;
    size?: string;
}

export class GoogleDriveService {
    private defaultFolderId: string;

    constructor() {
        this.defaultFolderId = env.GOOGLE_DRIVE_FOLDER_ID || '';
    }

    // Upload file to Google Drive
    async uploadFile(options: UploadFileOptions): Promise<DriveFile> {
        const { fileName, mimeType, buffer, folderId } = options;
        const targetFolderId = folderId || this.defaultFolderId;

        // Convert buffer to stream
        const stream = new Readable();
        stream.push(buffer);
        stream.push(null);

        const response = await drive.files.create({
            requestBody: {
                name: fileName,
                parents: targetFolderId ? [targetFolderId] : undefined,
            },
            media: {
                mimeType,
                body: stream,
            },
            fields: 'id, name, mimeType, webViewLink, webContentLink, size',
        });

        // Share file with domain-restricted access (organization only)
        // Falls back to 'anyone' only if GOOGLE_WORKSPACE_DOMAIN is not set
        const domain = process.env.GOOGLE_WORKSPACE_DOMAIN;
        if (domain) {
            await drive.permissions.create({
                fileId: response.data.id!,
                requestBody: {
                    role: 'reader',
                    type: 'domain',
                    domain: domain,
                },
            });
        } else {
            // Fallback: anyone within organization with link can view
            // WARNING: In production, set GOOGLE_WORKSPACE_DOMAIN for domain-restricted access
            if (process.env.NODE_ENV === 'production') {
                log.warn('[GoogleDrive] WARNING: GOOGLE_WORKSPACE_DOMAIN not set. Files will be shared with anyone who has the link. Set this env var for domain-restricted access.');
            }
            await drive.permissions.create({
                fileId: response.data.id!,
                requestBody: {
                    role: 'reader',
                    type: 'anyone',
                },
            });
        }

        return {
            id: response.data.id!,
            name: response.data.name!,
            mimeType: response.data.mimeType!,
            webViewLink: response.data.webViewLink!,
            webContentLink: response.data.webContentLink || undefined,
            size: response.data.size || undefined,
        };
    }

    // Get file metadata
    async getFile(fileId: string): Promise<DriveFile | null> {
        try {
            const response = await drive.files.get({
                fileId,
                fields: 'id, name, mimeType, webViewLink, webContentLink, size',
            });

            return {
                id: response.data.id!,
                name: response.data.name!,
                mimeType: response.data.mimeType!,
                webViewLink: response.data.webViewLink!,
                webContentLink: response.data.webContentLink || undefined,
                size: response.data.size || undefined,
            };
        } catch (error) {
            log.error({ err: error }, 'Failed to get file:');
            return null;
        }
    }

    // Delete file from Google Drive
    async deleteFile(fileId: string): Promise<boolean> {
        try {
            await drive.files.delete({ fileId });
            return true;
        } catch (error) {
            log.error({ err: error }, 'Failed to delete file:');
            return false;
        }
    }

    // Download file content as a readable stream from Google Drive
    async downloadFile(fileId: string): Promise<{ stream: Readable; mimeType: string; fileName: string } | null> {
        try {
            // Get file metadata first
            const meta = await drive.files.get({
                fileId,
                fields: 'name, mimeType',
            });

            // Download file content
            const response = await drive.files.get(
                { fileId, alt: 'media' },
                { responseType: 'stream' }
            );

            return {
                stream: response.data as unknown as Readable,
                mimeType: meta.data.mimeType || 'application/octet-stream',
                fileName: meta.data.name || 'download',
            };
        } catch (error) {
            log.error({ err: error, fileId }, 'Failed to download file from Drive');
            return null;
        }
    }

    // List files in folder
    async listFiles(folderId?: string): Promise<DriveFile[]> {
        const targetFolderId = folderId || this.defaultFolderId;

        const response = await drive.files.list({
            q: `'${targetFolderId}' in parents and trashed = false`,
            fields: 'files(id, name, mimeType, webViewLink, webContentLink, size)',
            orderBy: 'createdTime desc',
        });

        return (response.data.files || []).map((file) => ({
            id: file.id!,
            name: file.name!,
            mimeType: file.mimeType!,
            webViewLink: file.webViewLink!,
            webContentLink: file.webContentLink || undefined,
            size: file.size || undefined,
        }));
    }

    // Create folder
    async createFolder(name: string, parentFolderId?: string): Promise<string> {
        const response = await drive.files.create({
            requestBody: {
                name,
                mimeType: 'application/vnd.google-apps.folder',
                parents: parentFolderId ? [parentFolderId] : undefined,
            },
            fields: 'id',
        });

        return response.data.id!;
    }
}

export const googleDriveService = new GoogleDriveService();
export default googleDriveService;
