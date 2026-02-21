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
