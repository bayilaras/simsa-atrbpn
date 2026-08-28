import { db } from '../config/database';
import { fileAttachments, NewFileAttachment, FileAttachment } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { blobStorageService } from './blob-storage.service';
import crypto from 'crypto';
import type { Readable } from 'node:stream';
import { deleteRequestCreatedBlob } from '../utils/blob-upload-compensation.js';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';
import {
    AppError,
    ConflictError,
    GoneError,
    PayloadTooLargeError,
    ServiceUnavailableError,
} from '../utils/errors.js';
import {
    clientBlobUploadService,
    normalizeBlobLocator,
    type ClaimClientBlobUpload,
    type ClientBlobPurpose,
} from './client-blob-upload.service.js';

export const ATTACHMENT_PREFLIGHT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_PREFLIGHT_TIMEOUT_MS = 30_000;
export const ATTACHMENT_FINALIZATION_MARGIN_MS = 5_000;

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

export type PrepareExistingAttachmentData = Omit<
    RegisterExistingAttachmentData,
    'entityId' | 'entityType'
>;

export interface PreparedExistingAttachmentData {
    fileName: string;
    locator: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    uploadedById?: string;
}

export interface PrepareExistingAttachmentOptions {
    clientBlobClaim?: ClaimClientBlobUpload;
    expectedPurpose?: Extract<ClientBlobPurpose, 'surat_masuk' | 'surat_keluar'>;
    maxBytes?: number;
    timeoutMs?: number;
    now?: Date;
}

export type RegisterSuratAttachmentData = Omit<
    RegisterExistingAttachmentData,
    'entityId' | 'entityType'
>;

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
    /**
     * Resolve and verify immutable attachment metadata before a caller opens a
     * database transaction. Direct Blob registrations stream the object here;
     * multipart callers reuse their already-buffered bytes and never download
     * the just-uploaded object again.
     */
    async prepareExisting(
        data: PrepareExistingAttachmentData,
        options: PrepareExistingAttachmentOptions = {},
    ): Promise<PreparedExistingAttachmentData> {
        const locator = normalizeBlobLocator(data.locator);
        const maxBytes = options.maxBytes ?? ATTACHMENT_PREFLIGHT_MAX_BYTES;
        const timeoutMs = options.timeoutMs ?? ATTACHMENT_PREFLIGHT_TIMEOUT_MS;

        if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
            throw new Error('Attachment preflight byte limit must be positive.');
        }
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new Error('Attachment preflight timeout must be positive.');
        }

        let mimeType = data.mimeType || 'application/octet-stream';
        let sizeBytes = data.buffer?.length || 0;
        const digest = crypto.createHash('sha256');

        if (data.buffer) {
            if (options.clientBlobClaim) {
                throw new ConflictError('Lease direct Blob tidak boleh digunakan untuk unggahan multipart.');
            }
            if (sizeBytes > maxBytes) {
                throw new PayloadTooLargeError('Lampiran melebihi batas 10 MiB.');
            }
            digest.update(data.buffer);
        } else {
            const claim = options.clientBlobClaim;
            if (!claim) {
                throw new ConflictError('Lampiran direct Blob membutuhkan lease unggahan yang masih pending.');
            }
            if (
                normalizeBlobLocator(claim.blobUrl) !== locator
                || (options.expectedPurpose && claim.purpose !== options.expectedPurpose)
                || (data.uploadedById && claim.uploadedBy !== data.uploadedById)
            ) {
                throw new ConflictError('Lease unggahan Blob tidak sesuai dengan lampiran yang diregistrasi.');
            }

            await clientBlobUploadService.preAuthorizeClaim(
                claim,
                timeoutMs + ATTACHMENT_FINALIZATION_MARGIN_MS,
                options.now,
            );

            const controller = new AbortController();
            let stream: Readable | undefined;
            let timedOut = false;
            let timeoutHandle: NodeJS.Timeout | undefined;
            const timeoutError = new ServiceUnavailableError(
                'Preflight lampiran melampaui batas waktu. Silakan coba lagi.',
            );
            const timeoutPromise = new Promise<never>((_resolve, reject) => {
                timeoutHandle = setTimeout(() => {
                    timedOut = true;
                    controller.abort();
                    stream?.destroy();
                    reject(timeoutError);
                }, timeoutMs);
            });

            try {
                const downloadPromise = blobStorageService.downloadFile(locator, {
                    abortSignal: controller.signal,
                    throwOnError: true,
                }).then((download) => {
                    if (timedOut) download?.stream.destroy();
                    return download;
                });
                const download = await Promise.race([downloadPromise, timeoutPromise]);
                if (!download) {
                    throw new GoneError('Objek lampiran sudah tidak tersedia. Unggah ulang berkas.');
                }

                stream = download.stream;
                mimeType = download.mimeType;
                await Promise.race([
                    (async () => {
                        for await (const chunk of download.stream) {
                            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                            sizeBytes += bytes.length;
                            if (sizeBytes > maxBytes) {
                                download.stream.destroy();
                                throw new PayloadTooLargeError('Lampiran melebihi batas 10 MiB.');
                            }
                            digest.update(bytes);
                        }
                    })(),
                    timeoutPromise,
                ]);
            } catch (error) {
                if (error instanceof AppError) throw error;
                if (timedOut || controller.signal.aborted) throw timeoutError;
                throw new ServiceUnavailableError(
                    'Object storage sementara tidak tersedia untuk preflight lampiran.',
                );
            } finally {
                if (timeoutHandle) clearTimeout(timeoutHandle);
            }
        }

        return {
            fileName: data.fileName,
            locator,
            mimeType,
            sizeBytes,
            sha256: digest.digest('hex'),
            uploadedById: data.uploadedById,
        };
    }

    /** Persist metadata that was fully prepared before the transaction began. */
    async insertPrepared(
        data: PreparedExistingAttachmentData & Pick<RegisterExistingAttachmentData, 'entityId' | 'entityType'>,
        executor: Pick<typeof db, 'insert'> = db,
    ): Promise<FileAttachment> {
        const [attachment] = await executor.insert(fileAttachments).values({
            entityId: data.entityId,
            entityType: data.entityType,
            fileName: data.fileName,
            fileUrl: data.locator,
            mimeType: data.mimeType,
            sizeBytes: data.sizeBytes,
            sha256: data.sha256,
            storageAccess: 'private',
            uploadedBy: data.uploadedById || null,
            integrityStatus: 'baseline_recorded',
            malwareScanStatus: 'not_scanned',
        }).returning();

        return attachment;
    }

    /**
     * Compatibility helper for non-transactional callers. Transactional
     * workflows must call prepareExisting before opening their transaction and
     * insertPrepared from inside it.
     */
    async registerExisting(
        data: RegisterExistingAttachmentData,
        executor: Pick<typeof db, 'insert'> = db,
    ): Promise<FileAttachment> {
        const { entityId, entityType, ...source } = data;
        const prepared = await this.prepareExisting(source);
        return this.insertPrepared({ ...prepared, entityId, entityType }, executor);
    }

    // Upload file and create attachment record
    async create(
        data: CreateAttachmentData,
        auditContext: CriticalAuditContext,
    ): Promise<FileAttachment & { hash: string }> {
        // Calculate hash
        const hash = crypto.createHash('sha256').update(data.buffer).digest('hex');

        // Upload to Vercel Blob
        const blobFile = await blobStorageService.uploadFile({
            fileName: data.fileName,
            mimeType: data.mimeType,
            buffer: data.buffer,
        });

        try {
            return await db.transaction(async (tx) => {
                const [attachment] = await tx
                    .insert(fileAttachments)
                    .values({
                        entityId: data.suratId,
                        entityType: mapSuratTypeToEntityType(data.suratType),
                        fileName: data.fileName,
                        mimeType: data.mimeType,
                        sizeBytes: data.buffer.length,
                        fileUrl: blobFile.url,
                        sha256: hash,
                        storageAccess: 'private',
                        uploadedBy: data.uploadedById || null,
                        integrityStatus: 'baseline_recorded',
                        malwareScanStatus: 'not_scanned',
                    })
                    .returning();

                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'create',
                    entityType: 'file_attachment',
                    entityId: attachment.id,
                    changes: {
                        after: {
                            parentEntityId: data.suratId,
                            parentEntityType: mapSuratTypeToEntityType(data.suratType),
                            fileName: attachment.fileName,
                            mimeType: attachment.mimeType,
                            sizeBytes: attachment.sizeBytes,
                            sha256: attachment.sha256,
                            storageAccess: attachment.storageAccess,
                            malwareScanStatus: attachment.malwareScanStatus,
                        },
                    },
                }, tx);

                return { ...attachment, hash };
            });
        } catch (error) {
            await deleteRequestCreatedBlob(blobFile.url, {
                operation: 'file_attachment_create',
                entityType: data.suratType,
                entityId: data.suratId,
            });
            throw error;
        }
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
    async verifyIntegrity(id: string, executor: Pick<typeof db, 'select' | 'update'> = db): Promise<{
        attachment: FileAttachment;
        expectedHash: string;
        actualHash: string;
        matches: boolean;
    } | null> {
        const [attachment] = await executor
            .select()
            .from(fileAttachments)
            .where(eq(fileAttachments.id, id))
            .limit(1);
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

        const [updated] = await executor
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

    // Delete attachment and its private Blob object. driveFileId is retained
    // only as a read-compatible locator for legacy rows.
    async delete(id: string): Promise<boolean> {
        const attachment = await this.findById(id);
        if (!attachment) return false;

        // Delete from Vercel Blob
        const locator = attachment.fileUrl || attachment.driveFileId;
        if (locator) {
            await blobStorageService.deleteFile(locator);
        }

        // Delete database record
        await db.delete(fileAttachments).where(eq(fileAttachments.id, id));
        return true;
    }
}

export const fileAttachmentService = new FileAttachmentService();
export default fileAttachmentService;
