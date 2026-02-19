import { google } from 'googleapis';
import { Readable } from 'stream';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';

const log = createLogger('GoogleDriveService');

// Initialize Google Drive API with service account
const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
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
