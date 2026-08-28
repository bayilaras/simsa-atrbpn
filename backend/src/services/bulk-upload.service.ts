import { db } from '../config/database';
import { arsip, NewArsip } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { ocrService, ExtractedMetadata } from './ocr.service';
import { fileAttachmentService } from './file-attachment.service';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';

const log = createLogger('BulkUploadService');

export interface BulkUploadFile {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
}

export interface BulkUploadItem {
    id: string;
    fileName: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress: number;
    metadata?: ExtractedMetadata;
    arsipId?: string;
    error?: string;
}

export interface BulkUploadBatch {
    batchId: string;
    unitKerjaId: string;
    createdBy: string;
    totalFiles: number;
    processedFiles: number;
    items: BulkUploadItem[];
    status: 'pending' | 'processing' | 'completed' | 'partial';
    createdAt: Date;
}

// In-memory storage for batch tracking (in production, use Redis or database)
const batchStorage = new Map<string, BulkUploadBatch>();

class BulkUploadService {
    private readonly MAX_FILES = 50;
    private readonly ALLOWED_TYPES = ['application/pdf'];

    // Validate files before processing
    validateFiles(files: BulkUploadFile[]): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (files.length === 0) {
            errors.push('Tidak ada file yang diupload');
        }

        if (files.length > this.MAX_FILES) {
            errors.push(`Maksimum ${this.MAX_FILES} file per upload. Anda mengupload ${files.length} file.`);
        }

        files.forEach((file, index) => {
            if (!this.ALLOWED_TYPES.includes(file.mimeType)) {
                errors.push(`File "${file.fileName}" bukan PDF. Hanya file PDF yang diperbolehkan.`);
            }
        });

        return {
            valid: errors.length === 0,
            errors
        };
    }

    // Create a new batch for tracking
    createBatch(files: BulkUploadFile[], unitKerjaId: string, createdBy: string): BulkUploadBatch {
        const batchId = uuidv4();
        const items: BulkUploadItem[] = files.map(file => ({
            id: uuidv4(),
            fileName: file.fileName,
            status: 'pending',
            progress: 0
        }));

        const batch: BulkUploadBatch = {
            batchId,
            unitKerjaId,
            createdBy,
            totalFiles: files.length,
            processedFiles: 0,
            items,
            status: 'pending',
            createdAt: new Date()
        };

        batchStorage.set(batchId, batch);
        return batch;
    }

    // Get batch status
    getBatch(batchId: string): BulkUploadBatch | null {
        return batchStorage.get(batchId) || null;
    }

    // Process a batch of files
    async processBatch(
        batchId: string,
        files: BulkUploadFile[],
        folderId?: string
    ): Promise<BulkUploadBatch> {
        const batch = batchStorage.get(batchId);
        if (!batch) {
            throw new Error('Batch not found');
        }

        batch.status = 'processing';

        // Process files sequentially to avoid memory issues
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const item = batch.items[i];

            try {
                item.status = 'processing';
                item.progress = 10;

                // Extract text and metadata using OCR service
                const ocrResult = await ocrService.processPDF(file.buffer);
                item.progress = 70;

                if (ocrResult.success) {
                    item.metadata = ocrResult.metadata;
                    item.progress = 100;
                    item.status = 'completed';
                } else {
                    item.error = ocrResult.error;
                    item.status = 'failed';
                }
            } catch (error: any) {
                log.error(`Error processing file ${file.fileName}:`, error);
                item.status = 'failed';
                item.error = error.message || 'Processing failed';
            }

            batch.processedFiles++;
            batchStorage.set(batchId, batch);
        }

        // Determine final batch status
        const completedCount = batch.items.filter(i => i.status === 'completed').length;
        if (completedCount === batch.totalFiles) {
            batch.status = 'completed';
        } else if (completedCount > 0) {
            batch.status = 'partial';
        } else {
            batch.status = 'completed'; // All failed, but still completed
        }

        batchStorage.set(batchId, batch);
        return batch;
    }

    // Confirm and save batch items as arsip records
    async confirmBatch(
        batchId: string,
        confirmedItems: Array<{
            itemId: string;
            nomorBerkas?: string;
            uraianBerkas?: string;
            kodeKlasifikasi?: string;
            tahun: number;
            jenisArsip: string;
        }>,
        files: Map<string, Buffer>, // Map of itemId -> file buffer
        folderId?: string
    ): Promise<{ created: number; failed: number; arsipIds: string[] }> {
        const batch = batchStorage.get(batchId);
        if (!batch) {
            throw new Error('Batch not found');
        }

        let created = 0;
        let failed = 0;
        const arsipIds: string[] = [];

        for (const confirmedItem of confirmedItems) {
            const batchItem = batch.items.find(i => i.id === confirmedItem.itemId);
            if (!batchItem || batchItem.status !== 'completed') {
                failed++;
                continue;
            }

            try {
                // Create arsip record
                const [newArsip] = await db
                    .insert(arsip)
                    .values({
                        unitKerjaId: batch.unitKerjaId,
                        jenisArsip: confirmedItem.jenisArsip || 'masuk',
                        tahun: confirmedItem.tahun || new Date().getFullYear(),
                        nomorBerkas: confirmedItem.nomorBerkas || batchItem.metadata?.nomorSurat,
                        uraianBerkas: confirmedItem.uraianBerkas || batchItem.metadata?.perihal,
                        kodeKlasifikasi: confirmedItem.kodeKlasifikasi,
                        tanggalArsip: batchItem.metadata?.tanggalSurat || new Date().toISOString().split('T')[0],
                        nomorSuratOriginal: batchItem.metadata?.nomorSurat,
                        perihalOriginal: batchItem.metadata?.perihal,
                        tanggalSuratOriginal: batchItem.metadata?.tanggalSurat,
                        extractedText: batchItem.metadata?.extractedText,
                        ocrStatus: 'completed',
                        ocrProcessedAt: new Date(),
                        // OCR/imported labels are untrusted hints. The record
                        // remains fail-closed until an archivist reconciles it
                        // to immutable classification/JRA snapshots and records
                        // a separately verified retention event.
                        ruleProvenanceStatus: 'pending_jra',
                        retentionTriggerType: null,
                        retentionTriggerLabel: null,
                        retentionTriggerDate: null,
                        retentionTriggerEvidence: null,
                        tanggalKadaluarsa: null,
                        hasilAkhir: null,
                        createdBy: batch.createdBy
                    } as any)
                    .returning();

                arsipIds.push(newArsip.id);
                batchItem.arsipId = newArsip.id;

                // Upload file attachment if available
                const fileBuffer = files.get(confirmedItem.itemId);
                if (fileBuffer) {
                    await fileAttachmentService.create({
                        suratId: newArsip.id,
                        suratType: 'arsip',
                        fileName: batchItem.fileName,
                        mimeType: 'application/pdf',
                        buffer: fileBuffer,
                        folderId
                    });
                }

                created++;
            } catch (error: any) {
                log.error(`Error saving arsip for ${batchItem.fileName}:`, error);
                batchItem.error = error.message;
                failed++;
            }
        }

        batchStorage.set(batchId, batch);

        return { created, failed, arsipIds };
    }

    // Clean up old batches (call periodically)
    cleanupOldBatches(maxAgeMs: number = 3600000): void {
        const now = Date.now();
        for (const [batchId, batch] of batchStorage.entries()) {
            if (now - batch.createdAt.getTime() > maxAgeMs) {
                batchStorage.delete(batchId);
            }
        }
    }
}

export const bulkUploadService = new BulkUploadService();
export default bulkUploadService;
