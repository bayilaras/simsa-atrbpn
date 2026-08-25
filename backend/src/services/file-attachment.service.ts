import { db } from '../config/database';
import { fileAttachments, NewFileAttachment, FileAttachment } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { blobStorageService } from './blob-storage.service';
import crypto from 'crypto';

export interface CreateAttachmentData {
    suratId: string;
    suratType: 'masuk' | 'keluar' | 'arsip';
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    folderId?: string;
    uploadedById?: string;
}

export interface RegisterExistingAttachmentData {
    entityId: string;
    entityType: 'surat_masuk' | 'surat_keluar' | 'arsip';
    fileName: string;
    locator: string;
    mimeType?: string;
    buffer?: Buffer;
    uploadedById?: string;
}

// Map suratType to entityType for database storage
function mapSuratTypeToEntityType(suratType: 'masuk' | 'keluar' | 'arsip'): string {
    const mapping: Record<string, string> = {
        masuk: 'surat_masuk',
        keluar: 'surat_keluar',
        arsip: 'arsip',
    };
    return mapping[suratType] || suratType;
}

export class FileAttachmentService {
    async registerExisting(data: RegisterExistingAttachmentData): Promise<FileAttachment> {
        const locator = data.locator.startsWith('blob:')
            ? data.locator.slice('blob:'.length)
            : data.locator;

        let mimeType = data.mimeType || 'application/octet-stream';
        let sizeBytes = data.buffer?.length || 0;
        const digest = crypto.createHash('sha256');

        if (data.buffer) {
            digest.update(data.buffer);
        } else {
            const download = await blobStorageService.downloadFile(locator);
            if (!download) throw new Error('Bitstream tidak dapat diregistrasi dari object storage');
            mimeType = download.mimeType;
            for await (const chunk of download.stream) {
                const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                sizeBytes += bytes.length;
                digest.update(bytes);
            }
        }

        const [attachment] = await db.insert(fileAttachments).values({
            entityId: data.entityId,
            entityType: data.entityType,
            fileName: data.fileName,
            fileUrl: locator,
            driveFileId: locator,
            mimeType,
            sizeBytes,
            sha256: digest.digest('hex'),
            storageAccess: 'private',
            uploadedBy: data.uploadedById || null,
            integrityStatus: 'baseline_recorded',
            malwareScanStatus: 'not_scanned',
        }).returning();

        return attachment;
    }

    // Upload file and create attachment record
    async create(data: CreateAttachmentData): Promise<FileAttachment & { hash: string }> {
        // Calculate hash
        const hash = crypto.createHash('sha256').update(data.buffer).digest('hex');

        // Upload to Vercel Blob
        const blobFile = await blobStorageService.uploadFile({
            fileName: data.fileName,
            mimeType: data.mimeType,
            buffer: data.buffer,
        });

        // Create database record
        const [attachment] = await db
            .insert(fileAttachments)
            .values({
                entityId: data.suratId,
                entityType: mapSuratTypeToEntityType(data.suratType),
                fileName: data.fileName,
                mimeType: data.mimeType,
                sizeBytes: data.buffer.length,
                driveFileId: blobFile.url,
                fileUrl: blobFile.url,
                sha256: hash,
                storageAccess: 'private',
                uploadedBy: data.uploadedById || null,
                integrityStatus: 'baseline_recorded',
                malwareScanStatus: 'not_scanned',
            })
            .returning();

        return { ...attachment, hash };
    }

    // Get attachments for a surat
    async findBySurat(suratId: string, suratType: string): Promise<FileAttachment[]> {
        const entityType = mapSuratTypeToEntityType(suratType as 'masuk' | 'keluar' | 'arsip');
        return db
            .select()
            .from(fileAttachments)
            .where(
                and(
                    eq(fileAttachments.entityId, suratId),
                    eq(fileAttachments.entityType, entityType)
                )
            );
    }

    // Get single attachment
    async findById(id: string): Promise<FileAttachment | null> {
        const [result] = await db
            .select()
            .from(fileAttachments)
            .where(eq(fileAttachments.id, id))
            .limit(1);

        return result || null;
    }

    // Re-read the controlled bitstream and compare it with the immutable
    // baseline captured at ingest. This is used before verification and can be
    // scheduled periodically by an operations job.
    async verifyIntegrity(id: string): Promise<{
        attachment: FileAttachment;
        expectedHash: string;
        actualHash: string;
        matches: boolean;
    } | null> {
        const attachment = await this.findById(id);
        if (!attachment?.sha256 || !/^[a-f0-9]{64}$/i.test(attachment.sha256)) return null;

        const locator = attachment.fileUrl || attachment.driveFileId;
        if (!locator) return null;

        const download = await blobStorageService.downloadFile(locator);
        if (!download) return null;

        const digest = crypto.createHash('sha256');
        for await (const chunk of download.stream) {
            digest.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const actualHash = digest.digest('hex');
        const matches = crypto.timingSafeEqual(
            Buffer.from(attachment.sha256, 'hex'),
            Buffer.from(actualHash, 'hex'),
        );

        const [updated] = await db
            .update(fileAttachments)
            .set({
                integrityStatus: matches ? 'verified' : 'mismatch',
                lastFixityCheckAt: new Date(),
            })
            .where(eq(fileAttachments.id, id))
            .returning();

        return {
            attachment: updated || attachment,
            expectedHash: attachment.sha256,
            actualHash,
            matches,
        };
    }

    // Delete attachment (also deletes from Drive)
    async delete(id: string): Promise<boolean> {
        const attachment = await this.findById(id);
        if (!attachment) return false;

        // Delete from Vercel Blob
        if (attachment.driveFileId) {
            await blobStorageService.deleteFile(attachment.driveFileId);
        }

        // Delete database record
        await db.delete(fileAttachments).where(eq(fileAttachments.id, id));
        return true;
    }
}

export const fileAttachmentService = new FileAttachmentService();
export default fileAttachmentService;
