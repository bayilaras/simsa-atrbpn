import { db } from '../config/database';
import { fileAttachments, NewFileAttachment, FileAttachment } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
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
import { requireImmutableObjectGeneration } from '../storage/locator.js';
import { inspectBitstream } from './bitstream-integrity.js';
import { ARCHIVE_UPLOAD_MAX_BYTES, assertPdfUpload } from '../config/archive-upload.js';
import { isLetterAttachmentType, requiresAttachmentInspection } from './file-release-policy.js';

export const ATTACHMENT_PREFLIGHT_MAX_BYTES = ARCHIVE_UPLOAD_MAX_BYTES;
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
    objectGeneration?: string | null;
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
    sha256: string | null;
    uploadedById?: string;
    objectGeneration: string | null;
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
        const configuredMaxBytes = options.maxBytes ?? ATTACHMENT_PREFLIGHT_MAX_BYTES;
        const maxBytes = Math.min(configuredMaxBytes, ARCHIVE_UPLOAD_MAX_BYTES);
        const timeoutMs = options.timeoutMs ?? ATTACHMENT_PREFLIGHT_TIMEOUT_MS;

        if (!Number.isFinite(configuredMaxBytes) || maxBytes <= 0) {
            throw new Error('Attachment preflight byte limit must be positive.');
        }
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new Error('Attachment preflight timeout must be positive.');
        }

        let mimeType = data.mimeType || 'application/octet-stream';
        let sizeBytes = data.buffer?.length || 0;
        let objectGeneration: string | null;
        const inspect = requiresAttachmentInspection(options.expectedPurpose || options.clientBlobClaim?.purpose, locator);
        const digest = inspect ? crypto.createHash('sha256') : null;
        let prefix = Buffer.alloc(0);

        if (data.buffer) {
            if (options.clientBlobClaim) {
                throw new ConflictError('Lease direct Blob tidak boleh digunakan untuk unggahan multipart.');
            }
            if (sizeBytes > maxBytes) {
                throw new PayloadTooLargeError('Lampiran melebihi batas 10 MiB.');
            }
            objectGeneration = requireImmutableObjectGeneration(locator, data.objectGeneration);
            prefix = Buffer.from(data.buffer.subarray(0, 5));
            digest?.update(data.buffer);
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

            const lease = await clientBlobUploadService.preAuthorizeClaim(
                claim,
                timeoutMs + ATTACHMENT_FINALIZATION_MARGIN_MS,
                options.now,
            );
            objectGeneration = requireImmutableObjectGeneration(locator, lease.objectGeneration);
            if (data.objectGeneration && data.objectGeneration !== objectGeneration) {
                throw new ConflictError('Generasi object tidak sesuai dengan lease unggahan Blob.');
            }

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
                    generation: objectGeneration || undefined,
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
                            if (prefix.length < 5) prefix = Buffer.concat([prefix, bytes.subarray(0, 5 - prefix.length)]);
                            digest?.update(bytes);
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

        assertPdfUpload(data.fileName, mimeType, sizeBytes, prefix);
        return {
            fileName: data.fileName,
            locator,
            mimeType,
            sizeBytes,
            sha256: digest?.digest('hex') || null,
            uploadedById: data.uploadedById,
            objectGeneration,
        };
    }

    /** Persist metadata that was fully prepared before the transaction began. */
    async insertPrepared(
        data: PreparedExistingAttachmentData & Pick<RegisterExistingAttachmentData, 'entityId' | 'entityType'>,
        executor: Pick<typeof db, 'insert'> = db,
    ): Promise<FileAttachment> {
        const inspect = requiresAttachmentInspection(data.entityType, data.locator);
        const [attachment] = await executor.insert(fileAttachments).values({
            entityId: data.entityId,
            entityType: data.entityType,
            fileName: data.fileName,
            fileUrl: data.locator,
            objectGeneration: data.objectGeneration,
            mimeType: data.mimeType,
            sizeBytes: data.sizeBytes,
            sha256: inspect ? data.sha256 : null,
            storageAccess: 'private',
            uploadedBy: data.uploadedById || null,
            integrityStatus: inspect ? 'baseline_recorded' : 'not_required',
            malwareScanStatus: inspect ? 'not_scanned' : 'not_required',
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
        const prepared = await this.prepareExisting(source, {
            expectedPurpose: isLetterAttachmentType(entityType) ? entityType : undefined,
        });
        return this.insertPrepared({ ...prepared, entityId, entityType }, executor);
    }

    // Upload file and create attachment record
    async create(
        data: CreateAttachmentData,
        auditContext: CriticalAuditContext,
        executor?: Pick<typeof db, 'insert'>,
    ): Promise<FileAttachment & { hash: string | null }> {
        assertPdfUpload(data.fileName, data.mimeType, data.buffer.length, data.buffer);

        // All server-received bytes enter quarantine on GCS. The Vercel Blob
        // compatibility provider remains immutable and unchanged.
        const blobFile = await blobStorageService.uploadUntrustedFile({
            fileName: data.fileName,
            mimeType: data.mimeType,
            buffer: data.buffer,
        });
        const objectGeneration = requireImmutableObjectGeneration(
            blobFile.url,
            blobFile.generation,
        );

        try {
            const inspect = requiresAttachmentInspection(mapSuratTypeToEntityType(data.suratType), blobFile.url);
            const hash = inspect ? crypto.createHash('sha256').update(data.buffer).digest('hex') : null;
            const persist = async (tx: Pick<typeof db, 'insert'>) => {
                const [attachment] = await tx
                    .insert(fileAttachments)
                    .values({
                        entityId: data.suratId,
                        entityType: mapSuratTypeToEntityType(data.suratType),
                        fileName: data.fileName,
                        mimeType: data.mimeType,
                        sizeBytes: data.buffer.length,
                        fileUrl: blobFile.url,
                        objectGeneration,
                        sha256: hash,
                        storageAccess: 'private',
                        uploadedBy: data.uploadedById || null,
                        integrityStatus: inspect ? 'baseline_recorded' : 'not_required',
                        malwareScanStatus: inspect ? 'not_scanned' : 'not_required',
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
            };
            return executor ? await persist(executor) : await db.transaction(persist);
        } catch (error) {
            await deleteRequestCreatedBlob(blobFile.url, {
                operation: 'file_attachment_create',
                entityType: data.suratType,
                entityId: data.suratId,
            }, objectGeneration);
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
        if (!attachment || !requiresAttachmentInspection(attachment.entityType, attachment.fileUrl || attachment.driveFileId)
            || !attachment.sha256 || !/^[a-f0-9]{64}$/i.test(attachment.sha256)) return null;

        const locator = attachment.fileUrl || attachment.driveFileId;
        if (!locator) return null;

        const { actualHash, matches } = await inspectBitstream(
            attachment,
            (url, options) => blobStorageService.downloadFile(url, options),
        );

        const [updated] = await executor
            .update(fileAttachments)
            .set({
                integrityStatus: matches ? 'verified' : 'mismatch',
                lastFixityCheckAt: new Date(),
            })
            .where(and(
                eq(fileAttachments.id, id),
                eq(fileAttachments.sha256, attachment.sha256),
                eq(fileAttachments.sizeBytes, attachment.sizeBytes!),
                eq(fileAttachments.storageAccess, attachment.storageAccess),
                eq(fileAttachments.integrityStatus, attachment.integrityStatus),
                eq(fileAttachments.malwareScanStatus, attachment.malwareScanStatus),
                attachment.fileUrl ? eq(fileAttachments.fileUrl, attachment.fileUrl) : isNull(fileAttachments.fileUrl),
                attachment.driveFileId ? eq(fileAttachments.driveFileId, attachment.driveFileId) : isNull(fileAttachments.driveFileId),
                attachment.objectGeneration ? eq(fileAttachments.objectGeneration, attachment.objectGeneration) : isNull(fileAttachments.objectGeneration),
            ))
            .returning();

        if (!updated) throw new ConflictError('Baseline berkas berubah selama pemeriksaan integritas; ulangi pemeriksaan.');

        return {
            attachment: updated,
            expectedHash: attachment.sha256,
            actualHash,
            matches,
        };
    }

    // Delete attachment and its private Blob object. driveFileId is retained
    // only as a read-compatible locator for legacy rows.
    async delete(id: string): Promise<boolean> {
        const unconfirmed = new Error('Object deletion was not confirmed');
        try {
            return await db.transaction(async tx => {
                const [attachment] = await tx.select().from(fileAttachments)
                    .where(eq(fileAttachments.id, id)).limit(1).for('update');
                if (!attachment) return false;
                // FK and evidence triggers must reject deletion BEFORE any
                // irreversible storage call. A failed storage operation rolls
                // back this uncommitted row deletion.
                await tx.delete(fileAttachments).where(eq(fileAttachments.id, id));
                const locator = attachment.fileUrl || attachment.driveFileId;
                if (locator) {
                    const generation = requireImmutableObjectGeneration(locator, attachment.objectGeneration);
                    const deleted = generation
                        ? await blobStorageService.deleteFileGeneration(locator, generation)
                        : await blobStorageService.deleteFile(locator);
                    if (!deleted) throw unconfirmed;
                }
                // Storage and PostgreSQL do not share a distributed transaction:
                // a later DB commit failure still requires reconciliation.
                return true;
            });
        } catch (error) {
            if (error === unconfirmed) return false;
            throw error;
        }
    }
}

export const fileAttachmentService = new FileAttachmentService();
export default fileAttachmentService;
