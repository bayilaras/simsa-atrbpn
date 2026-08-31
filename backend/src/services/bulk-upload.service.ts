import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { db } from '../config/database.js';
import {
    arsip,
    bulkUploadBatches,
    bulkUploadItems,
    fileAttachments,
    ocrProcessingLeases,
    type BulkUploadBatchRow,
    type BulkUploadItemRow,
} from '../db/schema/index.js';
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { ocrService, type ExtractedMetadata } from './ocr.service.js';
import { blobStorageService } from './blob-storage.service.js';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger.js';
import { auditLogService, type CriticalAuditContext } from './audit-log.service.js';
import {
    ocrCapacityService,
    type OcrCapacityCoordinator,
    type OcrCapacityLease,
} from './ocr-capacity.service.js';
import { requireImmutableObjectGeneration } from '../storage/locator.js';

const log = createLogger('BulkUploadService');

export const BULK_UPLOAD_LIMITS = Object.freeze({
    maxFiles: 50,
    maxFileBytes: 50 * 1024 * 1024,
    maxBatchBytes: 100 * 1024 * 1024,
});

export const OCR_PROCESSING_BUDGETS = Object.freeze({
    // Migration 0026 enforces a minimum 240-second lease. Renew well before
    // that boundary and leave enough request budget for Blob acquisition.
    capacityRenewIntervalMs: 60_000,
    blobDownloadTimeoutMs: 30_000,
});

export interface BulkUploadFile {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
}

export interface BulkUploadItem {
    id: string;
    fileName: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'confirmed';
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
    status: 'pending' | 'processing' | 'completed' | 'partial' | 'confirmed' | 'expired';
    createdAt: Date;
    expiresAt: Date;
}

export interface ConfirmedBulkUploadItem {
    itemId: string;
    nomorBerkas?: string;
    uraianBerkas?: string;
    kodeKlasifikasi?: string;
    tahun: number;
    jenisArsip: string;
}

export interface BulkUploadCleanupResult {
    batchesExpired: number;
    blobsDeleted: number;
    blobsFailed: number;
    blobsProtected: number;
}

export interface BulkUploadServiceOptions {
    capacityCoordinator?: OcrCapacityCoordinator;
    capacityRenewIntervalMs?: number;
    blobDownloadTimeoutMs?: number;
}

export class BulkUploadError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number = 400,
        public readonly activeBatchId?: string,
        public readonly retryAfterSeconds?: number,
    ) {
        super(message);
        this.name = 'BulkUploadError';
    }
}

class OcrCapacityOwnershipError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'OcrCapacityOwnershipError';
    }
}

function isActiveBatchUniqueConflict(error: unknown): boolean {
    let current: unknown = error;
    for (let depth = 0; current && depth < 5; depth++) {
        if (typeof current !== 'object') return false;
        const record = current as Record<string, unknown>;
        if (
            record.constraint === 'bulk_upload_batches_one_active_owner_unit_idx'
            || String(record.message || '').includes('bulk_upload_batches_one_active_owner_unit_idx')
        ) {
            return true;
        }
        current = record.cause;
    }
    return false;
}

function safeBlobFileName(fileName: string): string {
    const normalized = fileName
        .normalize('NFKC')
        .replace(/[\\/]/g, '_')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .slice(-180);
    return normalized || 'arsip.pdf';
}

function asMetadata(value: Record<string, unknown> | null): ExtractedMetadata | undefined {
    return value ? value as unknown as ExtractedMetadata : undefined;
}

function itemBelongsToActiveBatch() {
    return sql`exists (
        select 1
        from ${bulkUploadBatches} active_batch
        where active_batch.id = ${bulkUploadItems.batchId}
          and active_batch.status in ('pending', 'processing', 'completed', 'partial')
          and active_batch.expires_at > now()
    )`;
}

export class BulkUploadService {
    private readonly MAX_FILES = BULK_UPLOAD_LIMITS.maxFiles;
    private readonly MAX_FILE_BYTES = BULK_UPLOAD_LIMITS.maxFileBytes;
    private readonly MAX_BATCH_BYTES = BULK_UPLOAD_LIMITS.maxBatchBytes;
    private readonly BATCH_TTL_MS = 24 * 60 * 60 * 1000;
    private readonly PROCESSING_LEASE_MS = 5 * 60 * 1000;
    private readonly capacityCoordinator: OcrCapacityCoordinator;
    private readonly capacityRenewIntervalMs: number;
    private readonly blobDownloadTimeoutMs: number;

    constructor(options: BulkUploadServiceOptions = {}) {
        this.capacityCoordinator = options.capacityCoordinator || ocrCapacityService;
        this.capacityRenewIntervalMs = Math.max(
            10,
            Math.floor(options.capacityRenewIntervalMs || OCR_PROCESSING_BUDGETS.capacityRenewIntervalMs),
        );
        this.blobDownloadTimeoutMs = Math.max(
            10,
            Math.floor(options.blobDownloadTimeoutMs || OCR_PROCESSING_BUDGETS.blobDownloadTimeoutMs),
        );
    }

    validateFiles(files: BulkUploadFile[]): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (files.length === 0) errors.push('Tidak ada file yang diupload');
        if (files.length > this.MAX_FILES) {
            errors.push(`Maksimum ${this.MAX_FILES} file per upload. Anda mengupload ${files.length} file.`);
        }
        const totalBytes = files.reduce((total, file) => total + file.buffer.length, 0);
        if (totalBytes > this.MAX_BATCH_BYTES) {
            errors.push('Ukuran total satu batch tidak boleh melebihi 100 MB.');
        }

        files.forEach((file) => {
            if (file.mimeType !== 'application/pdf') {
                errors.push(`File "${file.fileName}" bukan PDF. Hanya file PDF yang diperbolehkan.`);
            }
            if (!file.buffer.length || file.buffer.length > this.MAX_FILE_BYTES) {
                errors.push(`Ukuran file "${file.fileName}" harus antara 1 byte dan 50 MB.`);
            }
            if (file.fileName.length > 255) {
                errors.push(`Nama file "${file.fileName}" melebihi 255 karakter.`);
            }
            if (!file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
                errors.push(`File "${file.fileName}" tidak memiliki signature PDF yang valid.`);
            }
        });

        return { valid: errors.length === 0, errors };
    }

    async createBatch(
        files: BulkUploadFile[],
        unitKerjaId: string,
        createdBy: string,
    ): Promise<BulkUploadBatch> {
        const validation = this.validateFiles(files);
        if (!validation.valid) throw new BulkUploadError(validation.errors.join('; '));

        // Status, rather than wall-clock time, drives the partial unique index.
        // Tombstone stale rows first so an expired lease cannot block new work.
        await this.expireStaleOwnerBatches(createdBy, unitKerjaId);
        const existing = await this.getLatestActiveBatch(createdBy, unitKerjaId);
        if (existing) {
            throw new BulkUploadError(
                'Masih ada batch aktif untuk unit kerja ini',
                409,
                existing.batchId,
            );
        }

        const batchId = uuidv4();
        const createdAt = new Date();
        const expiresAt = new Date(createdAt.getTime() + this.BATCH_TTL_MS);
        const storedItems: Array<{
            id: string;
            file: BulkUploadFile;
            blobUrl: string;
            objectGeneration: string | null;
            sha256: string;
        }> = [];

        try {
            // Persist every source bitstream before returning a batch ID. OCR is
            // subsequently recoverable from Blob even if this process exits.
            for (const file of files) {
                const itemId = uuidv4();
                const stored = await blobStorageService.uploadUntrustedFile({
                    fileName: `${itemId}-${safeBlobFileName(file.fileName)}`,
                    mimeType: file.mimeType,
                    buffer: file.buffer,
                    folder: `bulk-upload/${batchId}`,
                });
                storedItems.push({
                    id: itemId,
                    file,
                    blobUrl: stored.url,
                    objectGeneration: requireImmutableObjectGeneration(
                        stored.url,
                        stored.generation,
                    ),
                    sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
                });
            }

            await db.transaction(async (tx) => {
                await tx.insert(bulkUploadBatches).values({
                    id: batchId,
                    unitKerjaId,
                    createdBy,
                    status: 'pending',
                    totalFiles: storedItems.length,
                    processedFiles: 0,
                    expiresAt,
                    createdAt,
                    updatedAt: createdAt,
                });
                await tx.insert(bulkUploadItems).values(storedItems.map(({
                    id,
                    file,
                    blobUrl,
                    objectGeneration,
                    sha256,
                }) => ({
                    id,
                    batchId,
                    fileName: file.fileName,
                    mimeType: file.mimeType,
                    sizeBytes: file.buffer.length,
                    sha256,
                    blobUrl,
                    objectGeneration,
                    status: 'pending' as const,
                    progress: 0,
                    createdAt,
                    updatedAt: createdAt,
                })));
            });
        } catch (error) {
            await this.compensateBlobs(storedItems.map(({ blobUrl, objectGeneration }) => ({
                locator: blobUrl,
                objectGeneration,
            })), 'batch creation');
            if (isActiveBatchUniqueConflict(error)) {
                const active = await this.getLatestActiveBatch(createdBy, unitKerjaId);
                throw new BulkUploadError(
                    'Masih ada batch aktif untuk unit kerja ini',
                    409,
                    active?.batchId,
                );
            }
            throw error;
        }

        return {
            batchId,
            unitKerjaId,
            createdBy,
            totalFiles: storedItems.length,
            processedFiles: 0,
            status: 'pending',
            createdAt,
            expiresAt,
            items: storedItems.map(({ id, file }) => ({
                id,
                fileName: file.fileName,
                status: 'pending',
                progress: 0,
            })),
        };
    }

    async getBatch(batchId: string): Promise<BulkUploadBatch | null> {
        const [batch] = await db
            .select()
            .from(bulkUploadBatches)
            .where(eq(bulkUploadBatches.id, batchId))
            .limit(1);
        if (!batch) return null;

        const items = await db
            .select()
            .from(bulkUploadItems)
            .where(eq(bulkUploadItems.batchId, batchId))
            .orderBy(asc(bulkUploadItems.createdAt));

        return this.toPublicBatch(batch, items);
    }

    /**
     * Return only the newest resumable batch owned by the authenticated user
     * in one concrete record unit. Keeping ownership in the query (including
     * for super administrators) prevents this recovery helper from becoming a
     * cross-user batch browser.
     */
    async getLatestActiveBatch(createdBy: string, unitKerjaId: string): Promise<BulkUploadBatch | null> {
        const [batch] = await db
            .select({ id: bulkUploadBatches.id })
            .from(bulkUploadBatches)
            .where(and(
                eq(bulkUploadBatches.createdBy, createdBy),
                eq(bulkUploadBatches.unitKerjaId, unitKerjaId),
                inArray(bulkUploadBatches.status, ['pending', 'processing', 'completed', 'partial']),
                gt(bulkUploadBatches.expiresAt, new Date()),
            ))
            .orderBy(desc(bulkUploadBatches.createdAt))
            .limit(1);

        return batch ? this.getBatch(batch.id) : null;
    }

    private async expireStaleOwnerBatches(createdBy: string, unitKerjaId: string): Promise<void> {
        const stale = await db
            .update(bulkUploadBatches)
            .set({ status: 'expired', confirmedAt: null, updatedAt: new Date() })
            .where(and(
                eq(bulkUploadBatches.createdBy, createdBy),
                eq(bulkUploadBatches.unitKerjaId, unitKerjaId),
                inArray(bulkUploadBatches.status, ['pending', 'processing', 'completed', 'partial']),
                lte(bulkUploadBatches.expiresAt, new Date()),
            ))
            .returning({ id: bulkUploadBatches.id });

        for (const { id } of stale) {
            const cleanup = await this.cleanupBatchBlobs(id);
            if (cleanup.blobsFailed > 0) {
                log.warn({ batchId: id, blobsFailed: cleanup.blobsFailed }, 'Stale batch cleanup will be retried');
            }
        }
    }

    async processBatch(batchId: string, maxItems: number = this.MAX_FILES): Promise<BulkUploadBatch> {
        const [batch] = await db
            .select()
            .from(bulkUploadBatches)
            .where(eq(bulkUploadBatches.id, batchId))
            .limit(1);
        if (!batch) throw new BulkUploadError('Batch not found', 404);
        if (batch.status === 'confirmed' || batch.status === 'expired' || batch.expiresAt <= new Date()) {
            throw new BulkUploadError('Batch tidak dapat diproses lagi', 409);
        }

        const leaseCutoff = new Date(Date.now() - this.PROCESSING_LEASE_MS);
        const candidates = await db
            .select()
            .from(bulkUploadItems)
            .where(and(
                eq(bulkUploadItems.batchId, batchId),
                or(
                    eq(bulkUploadItems.status, 'pending'),
                    and(
                        eq(bulkUploadItems.status, 'processing'),
                        or(
                            isNull(bulkUploadItems.processingStartedAt),
                            lt(bulkUploadItems.processingStartedAt, leaseCutoff),
                        ),
                    ),
                ),
            ))
            .orderBy(asc(bulkUploadItems.createdAt))
            .limit(Math.max(1, Math.min(this.MAX_FILES, maxItems)));

        let processedItems = 0;
        for (const candidate of candidates) {
            // Acquire global capacity before mutating the item. A full
            // semaphore is retryable and must never turn a pending document
            // into a failed one. The acquisition transaction is already
            // committed when this method proceeds to Blob download/Tesseract.
            const capacity = await this.capacityCoordinator.acquire(candidate.id);
            if (!capacity.acquired) {
                if (processedItems === 0) {
                    throw new BulkUploadError(
                        'Kapasitas OCR sedang penuh. Coba lagi sebentar.',
                        503,
                        undefined,
                        capacity.retryAfterSeconds,
                    );
                }
                break;
            }

            try {
                const startedAt = new Date();
                const [claimed] = await db.update(bulkUploadItems)
                    .set({
                        status: 'processing',
                        progress: 10,
                        processingStartedAt: startedAt,
                        error: null,
                        updatedAt: startedAt,
                    })
                    .where(and(
                        eq(bulkUploadItems.id, candidate.id),
                        itemBelongsToActiveBatch(),
                        or(
                            eq(bulkUploadItems.status, 'pending'),
                            and(
                                eq(bulkUploadItems.status, 'processing'),
                                or(
                                    isNull(bulkUploadItems.processingStartedAt),
                                    lt(bulkUploadItems.processingStartedAt, leaseCutoff),
                                ),
                            ),
                        ),
                    ))
                    .returning();
                if (!claimed) continue;

                processedItems++;
                const claimStartedAt = claimed.processingStartedAt || startedAt;
                const itemClaimFence = and(
                    eq(bulkUploadItems.id, claimed.id),
                    eq(bulkUploadItems.status, 'processing'),
                    eq(bulkUploadItems.processingStartedAt, claimStartedAt),
                );
                const activeClaimFence = and(itemClaimFence, itemBelongsToActiveBatch());
                const [activeBatch] = await db.update(bulkUploadBatches)
                    .set({ status: 'processing', updatedAt: startedAt })
                    .where(and(
                        eq(bulkUploadBatches.id, batchId),
                        inArray(bulkUploadBatches.status, ['pending', 'processing', 'completed', 'partial']),
                        gt(bulkUploadBatches.expiresAt, sql`now()`),
                    ))
                    .returning({ id: bulkUploadBatches.id });
                if (!activeBatch) {
                    await db.update(bulkUploadItems)
                        .set({
                            status: 'pending',
                            progress: 0,
                            processingStartedAt: null,
                            error: null,
                            updatedAt: new Date(),
                        })
                        .where(itemClaimFence);
                    continue;
                }

                try {
                    const ocrResult = await this.withCapacityRenewal(
                        capacity.lease,
                        async (signal) => {
                            const buffer = await this.readAndVerifyBlob(claimed, signal);
                            if (signal.aborted) throw signal.reason;
                            return ocrService.processPDF(buffer, signal);
                        },
                    );
                    const completedAt = new Date();
                    const [updated] = await db.update(bulkUploadItems)
                        .set(ocrResult.success ? {
                            status: 'completed',
                            progress: 100,
                            metadata: ocrResult.metadata as unknown as Record<string, unknown>,
                            error: null,
                            completedAt,
                            updatedAt: completedAt,
                        } : {
                            status: 'failed',
                            progress: 100,
                            error: ocrResult.error || 'OCR gagal',
                            completedAt,
                            updatedAt: completedAt,
                        })
                        .where(activeClaimFence)
                        .returning({ id: bulkUploadItems.id });
                    if (!updated) {
                        log.warn(
                            { itemId: claimed.id, claimStartedAt },
                            'Discarded OCR result from a stale item claim',
                        );
                    }
                } catch (error) {
                    if (error instanceof OcrCapacityOwnershipError) {
                        log.warn(
                            { err: error, itemId: claimed.id, claimStartedAt },
                            'OCR capacity ownership was lost; item returned to the retry queue',
                        );
                        await db.update(bulkUploadItems)
                            .set({
                                status: 'pending',
                                progress: 0,
                                processingStartedAt: null,
                                error: null,
                                updatedAt: new Date(),
                            })
                            .where(activeClaimFence);
                        continue;
                    }
                    const message = error instanceof Error ? error.message : 'Processing failed';
                    log.error({ err: error, itemId: claimed.id }, 'Bulk OCR item failed');
                    const [failed] = await db.update(bulkUploadItems)
                        .set({
                            status: 'failed',
                            progress: 100,
                            error: message,
                            completedAt: new Date(),
                            updatedAt: new Date(),
                        })
                        .where(activeClaimFence)
                        .returning({ id: bulkUploadItems.id });
                    if (!failed) {
                        log.warn(
                            { itemId: claimed.id, claimStartedAt },
                            'Discarded OCR failure from a stale item claim',
                        );
                    }
                }
            } finally {
                try {
                    const released = await this.capacityCoordinator.release(capacity.lease);
                    if (!released) {
                        log.warn({ itemId: candidate.id }, 'OCR capacity lease was not released by its token');
                    }
                } catch (error) {
                    // Fail safe: an abandoned capacity row expires according to
                    // database time and can then be reclaimed by another host.
                    log.error({ err: error, itemId: candidate.id }, 'OCR capacity lease release failed');
                }
            }
        }

        await this.refreshBatchProgress(batchId);
        const refreshed = await this.getBatch(batchId);
        if (!refreshed) throw new BulkUploadError('Batch not found', 404);
        return refreshed;
    }

    async confirmBatch(
        batchId: string,
        confirmedItems: ConfirmedBulkUploadItem[],
        auditContext: CriticalAuditContext,
    ): Promise<{ created: number; failed: number; arsipIds: string[] }> {
        if (confirmedItems.length === 0) {
            throw new BulkUploadError('Minimal satu item harus dikonfirmasi');
        }
        const itemIds = confirmedItems.map(({ itemId }) => itemId);
        if (new Set(itemIds).size !== itemIds.length) {
            throw new BulkUploadError('Item konfirmasi tidak boleh duplikat');
        }

        // Fail before opening the write transaction if any source object has
        // disappeared. Confirmation never creates an archive with a dead locator.
        const sourceRows = await db
            .select()
            .from(bulkUploadItems)
            .where(and(
                eq(bulkUploadItems.batchId, batchId),
                inArray(bulkUploadItems.id, itemIds),
            ));
        if (sourceRows.length !== itemIds.length) {
            throw new BulkUploadError('Item batch tidak ditemukan', 404);
        }
        for (const item of sourceRows) {
            if (item.status !== 'completed' || item.arsipId) {
                throw new BulkUploadError(`Item ${item.id} belum siap atau sudah dikonfirmasi`, 409);
            }
            const objectGeneration = requireImmutableObjectGeneration(
                item.blobUrl,
                item.objectGeneration,
            );
            const stored = await blobStorageService.getFile(item.blobUrl, {
                generation: objectGeneration || undefined,
            });
            if (!stored || stored.size !== item.sizeBytes) {
                throw new BulkUploadError(`Bitstream ${item.fileName} tidak tersedia atau berubah`, 409);
            }
        }

        return db.transaction(async (tx) => {
            const [batch] = await tx
                .select()
                .from(bulkUploadBatches)
                .where(eq(bulkUploadBatches.id, batchId))
                .for('update')
                .limit(1);
            if (!batch) throw new BulkUploadError('Batch not found', 404);
            if (batch.status === 'confirmed' || batch.status === 'expired' || batch.expiresAt <= new Date()) {
                throw new BulkUploadError('Batch sudah dikonfirmasi atau kedaluwarsa', 409);
            }

            const lockedItems = await tx
                .select()
                .from(bulkUploadItems)
                .where(and(
                    eq(bulkUploadItems.batchId, batchId),
                    inArray(bulkUploadItems.id, itemIds),
                ))
                .for('update');
            if (
                lockedItems.length !== itemIds.length
                || lockedItems.some(item => item.status !== 'completed' || item.arsipId)
            ) {
                throw new BulkUploadError('Item batch berubah atau tidak siap dikonfirmasi', 409);
            }

            const rowById = new Map(lockedItems.map(item => [item.id, item]));
            const arsipIds: string[] = [];
            for (const confirmedItem of confirmedItems) {
                const item = rowById.get(confirmedItem.itemId)!;
                const metadata = asMetadata(item.metadata);
                const [newArsip] = await tx.insert(arsip).values({
                    unitKerjaId: batch.unitKerjaId,
                    jenisArsip: confirmedItem.jenisArsip || 'masuk',
                    mediaType: 'elektronik',
                    tahun: confirmedItem.tahun || new Date().getFullYear(),
                    nomorBerkas: confirmedItem.nomorBerkas || metadata?.nomorSurat,
                    uraianBerkas: confirmedItem.uraianBerkas || metadata?.perihal,
                    kodeKlasifikasi: confirmedItem.kodeKlasifikasi,
                    tanggalArsip: metadata?.tanggalSurat || new Date().toISOString().split('T')[0],
                    nomorSuratOriginal: metadata?.nomorSurat,
                    perihalOriginal: metadata?.perihal,
                    tanggalSuratOriginal: metadata?.tanggalSurat,
                    extractedText: metadata?.extractedText,
                    ocrStatus: 'completed',
                    ocrProcessedAt: item.completedAt || new Date(),
                    ruleProvenanceStatus: 'pending_jra',
                    retentionTriggerType: null,
                    retentionTriggerLabel: null,
                    retentionTriggerDate: null,
                    retentionTriggerEvidence: null,
                    tanggalKadaluarsa: null,
                    hasilAkhir: null,
                    createdBy: batch.createdBy,
                }).returning();
                if (!newArsip) throw new Error('Arsip gagal dibuat');

                await tx.insert(fileAttachments).values({
                    entityId: newArsip.id,
                    entityType: 'arsip',
                    fileName: item.fileName,
                    fileUrl: item.blobUrl,
                    objectGeneration: item.objectGeneration,
                    mimeType: item.mimeType,
                    sizeBytes: item.sizeBytes,
                    sha256: item.sha256,
                    storageAccess: 'private',
                    uploadedBy: batch.createdBy,
                    integrityStatus: 'baseline_recorded',
                    malwareScanStatus: 'not_scanned',
                });

                const confirmedAt = new Date();
                await tx.update(bulkUploadItems)
                    .set({
                        status: 'confirmed',
                        progress: 100,
                        arsipId: newArsip.id,
                        confirmedAt,
                        updatedAt: confirmedAt,
                    })
                    .where(and(
                        eq(bulkUploadItems.id, item.id),
                        eq(bulkUploadItems.status, 'completed'),
                    ));
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'create',
                    entityType: 'arsip',
                    entityId: newArsip.id,
                    changes: {
                        after: {
                            id: newArsip.id,
                            unitKerjaId: batch.unitKerjaId,
                            source: 'bulk_upload',
                            batchId,
                            itemId: item.id,
                            fileName: item.fileName,
                            sha256: item.sha256,
                        },
                    },
                }, tx);
                arsipIds.push(newArsip.id);
            }

            const remaining = await tx
                .select({ id: bulkUploadItems.id })
                .from(bulkUploadItems)
                .where(and(
                    eq(bulkUploadItems.batchId, batchId),
                    ne(bulkUploadItems.status, 'confirmed'),
                ));
            const now = new Date();
            await tx.update(bulkUploadBatches)
                .set(remaining.length === 0 ? {
                    status: 'confirmed',
                    confirmedAt: now,
                    updatedAt: now,
                } : {
                    status: 'partial',
                    confirmedAt: null,
                    updatedAt: now,
                })
                .where(eq(bulkUploadBatches.id, batchId));

            return { created: arsipIds.length, failed: 0, arsipIds };
        });
    }

    async cleanupOldBatches(maxAgeMs: number = this.BATCH_TTL_MS): Promise<BulkUploadCleanupResult> {
        const cutoff = new Date(Date.now() - maxAgeMs);
        const candidates = await db
            .select()
            .from(bulkUploadBatches)
            .where(and(
                ne(bulkUploadBatches.status, 'confirmed'),
                or(
                    lt(bulkUploadBatches.expiresAt, new Date()),
                    lt(bulkUploadBatches.createdAt, cutoff),
                ),
            ));
        const result: BulkUploadCleanupResult = {
            batchesExpired: 0,
            blobsDeleted: 0,
            blobsFailed: 0,
            blobsProtected: 0,
        };

        for (const candidate of candidates) {
            const [expired] = await db.update(bulkUploadBatches)
                .set({ status: 'expired', confirmedAt: null, updatedAt: new Date() })
                .where(and(
                    eq(bulkUploadBatches.id, candidate.id),
                    ne(bulkUploadBatches.status, 'confirmed'),
                ))
                .returning();
            if (!expired) continue;

            const cleanup = await this.cleanupBatchBlobs(candidate.id);
            result.blobsDeleted += cleanup.blobsDeleted;
            result.blobsFailed += cleanup.blobsFailed;
            result.blobsProtected += cleanup.blobsProtected;
            // Keep the expired batch and item rows as durable provenance. A
            // failed deletion retains blobDeletedAt=NULL and is retried later.
            result.batchesExpired++;
        }

        return result;
    }

    async cancelBatch(batchId: string): Promise<BulkUploadCleanupResult> {
        const [batch] = await db.select({ status: bulkUploadBatches.status })
            .from(bulkUploadBatches)
            .where(eq(bulkUploadBatches.id, batchId))
            .limit(1);
        if (!batch) throw new BulkUploadError('Batch not found', 404);
        if (batch.status === 'confirmed') {
            throw new BulkUploadError('Batch yang sudah dikonfirmasi tidak dapat dibatalkan', 409);
        }

        const [expired] = await db.update(bulkUploadBatches)
            .set({ status: 'expired', confirmedAt: null, updatedAt: new Date() })
            .where(and(
                eq(bulkUploadBatches.id, batchId),
                ne(bulkUploadBatches.status, 'confirmed'),
            ))
            .returning({ id: bulkUploadBatches.id });
        if (!expired) throw new BulkUploadError('Status batch berubah; pembatalan ditolak', 409);

        const cleanup = await this.cleanupBatchBlobs(batchId);
        return { batchesExpired: 1, ...cleanup };
    }

    private async cleanupBatchBlobs(batchId: string): Promise<Omit<BulkUploadCleanupResult, 'batchesExpired'>> {
        const result = { blobsDeleted: 0, blobsFailed: 0, blobsProtected: 0 };
        const items = await db.select().from(bulkUploadItems)
            .where(eq(bulkUploadItems.batchId, batchId));
        const locators = [...new Set(items.map(({ blobUrl }) => blobUrl))];
        const referenced = locators.length === 0 ? [] : await db
            .select({ fileUrl: fileAttachments.fileUrl, driveFileId: fileAttachments.driveFileId })
            .from(fileAttachments)
            .where(or(
                inArray(fileAttachments.fileUrl, locators),
                inArray(fileAttachments.driveFileId, locators),
            ));
        const protectedLocators = new Set(
            referenced.flatMap(row => [row.fileUrl, row.driveFileId]).filter(Boolean) as string[],
        );
        const leasedItems = items.length === 0 ? [] : await db
            .select({ itemId: ocrProcessingLeases.itemId })
            .from(ocrProcessingLeases)
            .where(and(
                inArray(ocrProcessingLeases.itemId, items.map(item => item.id)),
                gt(ocrProcessingLeases.leaseExpiresAt, sql`now()`),
            ));
        const leasedItemIds = new Set(leasedItems.map(({ itemId }) => itemId));
        for (const item of items) {
            const locator = item.blobUrl;
            if (leasedItemIds.has(item.id) || protectedLocators.has(locator)) {
                result.blobsProtected++;
                continue;
            }
            if (item.blobDeletedAt) continue;
            const objectGeneration = requireImmutableObjectGeneration(
                locator,
                item.objectGeneration,
            );
            const deleted = objectGeneration
                ? await blobStorageService.deleteFileGeneration(locator, objectGeneration)
                : await blobStorageService.deleteFile(locator);
            if (deleted) {
                result.blobsDeleted++;
                await db.update(bulkUploadItems)
                    .set({ blobDeletedAt: new Date(), updatedAt: new Date() })
                    .where(and(
                        eq(bulkUploadItems.id, item.id),
                        isNull(bulkUploadItems.blobDeletedAt),
                    ));
            } else {
                result.blobsFailed++;
            }
        }
        return result;
    }

    private async refreshBatchProgress(batchId: string): Promise<void> {
        const items = await db.select({ status: bulkUploadItems.status })
            .from(bulkUploadItems)
            .where(eq(bulkUploadItems.batchId, batchId));
        const processedFiles = items.filter(({ status }) => (
            status === 'completed' || status === 'failed' || status === 'confirmed'
        )).length;
        const failed = items.filter(({ status }) => status === 'failed').length;
        const unfinished = items.some(({ status }) => status === 'pending' || status === 'processing');
        const status = unfinished
            ? 'processing'
            : failed > 0
                ? 'partial'
                : 'completed';
        await db.update(bulkUploadBatches)
            .set({ processedFiles, status, updatedAt: new Date() })
            .where(and(
                eq(bulkUploadBatches.id, batchId),
                ne(bulkUploadBatches.status, 'expired'),
                ne(bulkUploadBatches.status, 'confirmed'),
            ));
    }

    /** Keep a global slot alive without holding a database transaction during I/O/OCR. */
    private async withCapacityRenewal<T>(
        lease: OcrCapacityLease,
        operation: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
        const controller = new AbortController();
        let stopped = false;
        let renewalTimer: NodeJS.Timeout | null = null;
        const renewalState: { inFlight: Promise<void> | null } = { inFlight: null };
        let ownershipLost: OcrCapacityOwnershipError | null = null;

        const loseOwnership = (message: string, cause?: unknown) => {
            if (ownershipLost) return;
            ownershipLost = new OcrCapacityOwnershipError(
                message,
                cause === undefined ? undefined : { cause },
            );
            controller.abort(ownershipLost);
        };
        const scheduleRenewal = () => {
            if (stopped || ownershipLost || renewalTimer) return;
            renewalTimer = setTimeout(() => {
                renewalTimer = null;
                const pending = (async () => {
                    try {
                        const renewed = await this.capacityCoordinator.renew(lease);
                        if (!renewed) {
                            loseOwnership('Lease kapasitas OCR tidak lagi dimiliki oleh proses ini');
                            return;
                        }
                        lease.leaseExpiresAt = renewed.leaseExpiresAt;
                    } catch (error) {
                        // A transient renewal error does not prove ownership was
                        // lost. Retry on the next heartbeat, then require one
                        // successful token-checked renewal before committing.
                        log.error({ err: error, itemId: lease.itemId }, 'OCR capacity lease renewal failed');
                    }
                })();
                renewalState.inFlight = pending;
                void pending.finally(() => {
                    if (renewalState.inFlight === pending) renewalState.inFlight = null;
                    scheduleRenewal();
                });
            }, this.capacityRenewIntervalMs);
            renewalTimer.unref?.();
        };

        scheduleRenewal();
        let value!: T;
        let operationError: unknown;
        let operationFailed = false;
        try {
            try {
                value = await operation(controller.signal);
            } catch (error) {
                operationFailed = true;
                operationError = error;
            }

            stopped = true;
            if (renewalTimer) clearTimeout(renewalTimer);
            renewalTimer = null;
            if (renewalState.inFlight) await renewalState.inFlight;

            if (ownershipLost) throw ownershipLost;
            if (operationFailed) throw operationError;

            // Fence the commit with one last database-authoritative renewal.
            // A stale worker may finish CPU work, but it can never persist it.
            let renewed: OcrCapacityLease | null;
            try {
                renewed = await this.capacityCoordinator.renew(lease);
            } catch (error) {
                throw new OcrCapacityOwnershipError(
                    'Kepemilikan lease OCR tidak dapat diverifikasi sebelum penyimpanan hasil',
                    { cause: error },
                );
            }
            if (!renewed) {
                throw new OcrCapacityOwnershipError(
                    'Lease kapasitas OCR kedaluwarsa sebelum hasil dapat disimpan',
                );
            }
            lease.leaseExpiresAt = renewed.leaseExpiresAt;
            return value;
        } finally {
            stopped = true;
            if (renewalTimer) clearTimeout(renewalTimer);
            const pending = renewalState.inFlight;
            if (pending) await pending.catch(() => undefined);
        }
    }

    private async readAndVerifyBlob(
        item: BulkUploadItemRow,
        capacitySignal?: AbortSignal,
    ): Promise<Buffer> {
        let stream: Readable | null = null;
        let aborted = false;
        let rejectAbort!: (reason: Error) => void;
        const abortPromise = new Promise<never>((_resolve, reject) => {
            rejectAbort = reject;
        });
        const abort = (reason: unknown) => {
            if (aborted) return;
            aborted = true;
            stream?.destroy();
            rejectAbort(reason instanceof Error ? reason : new Error('Pengunduhan bitstream dibatalkan'));
        };
        const onCapacityAbort = () => abort(capacitySignal?.reason);
        if (capacitySignal?.aborted) onCapacityAbort();
        else capacitySignal?.addEventListener('abort', onCapacityAbort, { once: true });

        const timeout = setTimeout(() => {
            abort(new Error('Waktu pengunduhan bitstream sumber habis'));
        }, this.blobDownloadTimeoutMs);
        timeout.unref?.();

        try {
            const objectGeneration = requireImmutableObjectGeneration(
                item.blobUrl,
                item.objectGeneration,
            );
            const downloadPromise = blobStorageService.downloadFile(item.blobUrl, {
                generation: objectGeneration || undefined,
            }).then((download) => {
                if (aborted) download?.stream.destroy();
                return download;
            });
            const download = await Promise.race([downloadPromise, abortPromise]);
            if (!download) throw new Error('Bitstream sumber tidak dapat dibaca dari object storage');
            stream = download.stream;
            if (aborted) {
                stream.destroy();
                throw capacitySignal?.reason || new Error('Pengunduhan bitstream dibatalkan');
            }
            if (download.mimeType !== 'application/pdf') throw new Error('Mime type bitstream bukan PDF');

            const readStream = (async () => {
                const chunks: Buffer[] = [];
                let total = 0;
                for await (const chunk of stream!) {
                    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    total += bytes.length;
                    if (total > this.MAX_FILE_BYTES || total > item.sizeBytes) {
                        throw new Error('Ukuran bitstream berubah atau melebihi batas');
                    }
                    chunks.push(bytes);
                }
                return Buffer.concat(chunks);
            })();
            const buffer = await Promise.race([readStream, abortPromise]);
            const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
            if (buffer.length !== item.sizeBytes || actualHash !== item.sha256) {
                throw new Error('Integritas bitstream sumber tidak cocok');
            }
            return buffer;
        } finally {
            clearTimeout(timeout);
            capacitySignal?.removeEventListener('abort', onCapacityAbort);
            if (aborted) stream?.destroy();
        }
    }

    private toPublicBatch(batch: BulkUploadBatchRow, items: BulkUploadItemRow[]): BulkUploadBatch {
        return {
            batchId: batch.id,
            unitKerjaId: batch.unitKerjaId,
            createdBy: batch.createdBy,
            totalFiles: batch.totalFiles,
            processedFiles: batch.processedFiles,
            status: batch.status as BulkUploadBatch['status'],
            createdAt: batch.createdAt,
            expiresAt: batch.expiresAt,
            items: items.map(item => ({
                id: item.id,
                fileName: item.fileName,
                status: item.status as BulkUploadItem['status'],
                progress: item.progress,
                metadata: asMetadata(item.metadata),
                arsipId: item.arsipId || undefined,
                error: item.error || undefined,
            })),
        };
    }

    private async compensateBlobs(
        objects: Array<{ locator: string; objectGeneration: string | null }>,
        context: string,
    ): Promise<void> {
        for (const { locator, objectGeneration: candidateGeneration } of objects) {
            const objectGeneration = requireImmutableObjectGeneration(locator, candidateGeneration);
            const deleted = objectGeneration
                ? await blobStorageService.deleteFileGeneration(locator, objectGeneration)
                : await blobStorageService.deleteFile(locator);
            if (!deleted) {
                log.error({ locator, context }, 'Blob compensation failed; manual cleanup required');
            }
        }
    }
}

export const bulkUploadService = new BulkUploadService();
export default bulkUploadService;
