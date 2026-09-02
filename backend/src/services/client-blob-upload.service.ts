import { and, asc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { clientBlobUploads, type ClientBlobUpload } from '../db/schema/index.js';
import { ConflictError, ValidationError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { blobStorageService } from './blob-storage.service.js';
import { toGcsLocator } from '../storage/locator.js';

const log = createLogger('ClientBlobUploadService');

export type ClientBlobPurpose = 'surat_masuk' | 'surat_keluar' | 'regulatory_source';

export interface CompletedClientBlobUpload {
    blobUrl: string;
    pathname: string;
    purpose: ClientBlobPurpose;
    uploadedBy: string;
}

export interface ClaimClientBlobUpload {
    blobUrl: string;
    purpose: ClientBlobPurpose;
    uploadedBy: string;
}

export interface AuthorizedGcsUpload {
    id: string;
    blobUrl: string;
    pathname: string;
    bucket: string;
    purpose: ClientBlobPurpose;
    uploadedBy: string;
    expectedSizeBytes: number;
    expectedContentType: string;
}

export interface FinalizedGcsUpload {
    eventId: string;
    uploadId: string;
    bucket: string;
    pathname: string;
    generation: string;
    sizeBytes: number;
    contentType: string;
    uploadedBy: string;
    purpose: ClientBlobPurpose;
}

export interface GcsFinalizationResult {
    upload: ClientBlobUpload;
    disposition: 'finalized' | 'duplicate';
}

const DEFAULT_CLAIM_TTL_HOURS = 24;
const MIN_CLAIM_TTL_HOURS = 1;
const MAX_CLAIM_TTL_HOURS = 168;
const STALE_CLEANUP_CLAIM_MS = 15 * 60 * 1000;
const CLEANUP_RETRY_BASE_MS = 60 * 1000;
const CLEANUP_RETRY_MAX_MS = 60 * 60 * 1000;

export function clientBlobCleanupRetryDelayMs(attempt: number): number {
    const safeAttempt = Math.max(1, Math.min(Math.floor(attempt), 31));
    return Math.min(CLEANUP_RETRY_BASE_MS * (2 ** (safeAttempt - 1)), CLEANUP_RETRY_MAX_MS);
}

export function clientBlobClaimTtlMs(source: NodeJS.ProcessEnv = process.env): number {
    const configured = Number(source.CLIENT_BLOB_UPLOAD_TTL_HOURS || DEFAULT_CLAIM_TTL_HOURS);
    if (
        !Number.isFinite(configured)
        || configured < MIN_CLAIM_TTL_HOURS
        || configured > MAX_CLAIM_TTL_HOURS
    ) {
        throw new Error(
            `CLIENT_BLOB_UPLOAD_TTL_HOURS must be between ${MIN_CLAIM_TTL_HOURS} and ${MAX_CLAIM_TTL_HOURS}`,
        );
    }
    return Math.floor(configured * 60 * 60 * 1000);
}

export function normalizeBlobLocator(value: string): string {
    return value.startsWith('blob:') ? value.slice('blob:'.length) : value;
}

function expectedPrefix(purpose: ClientBlobPurpose): string {
    switch (purpose) {
        case 'surat_masuk': return 'surat-masuk/';
        case 'surat_keluar': return 'surat-keluar/';
        case 'regulatory_source': return 'regulatory-sources/';
    }
}

function assertExpectedPath(purpose: ClientBlobPurpose, pathname: string): void {
    if (
        !pathname.startsWith(expectedPrefix(purpose))
        || pathname.includes('..')
        || pathname.includes('\\')
        || pathname.startsWith('/')
    ) {
        throw new ValidationError('Ruang nama object upload tidak valid.');
    }
}

function assertCallbackOwnedLocator(input: CompletedClientBlobUpload): string {
    const blobUrl = normalizeBlobLocator(input.blobUrl);
    let parsed: URL;
    try {
        parsed = new URL(blobUrl);
    } catch {
        throw new ValidationError('Callback Blob tidak memiliki locator yang valid.');
    }

    if (
        parsed.protocol !== 'https:'
        || !parsed.hostname.endsWith('.private.blob.vercel-storage.com')
        || parsed.username
        || parsed.password
        || parsed.search
        || parsed.hash
    ) {
        throw new ValidationError('Callback hanya menerima locator private Blob yang kanonis.');
    }

    let locatorPath: string;
    try {
        locatorPath = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    } catch {
        throw new ValidationError('Pathname Blob tidak valid.');
    }
    if (
        locatorPath !== input.pathname
        || !input.pathname.startsWith(expectedPrefix(input.purpose))
        || input.pathname.includes('..')
        || input.pathname.includes('\\')
    ) {
        throw new ValidationError('Callback Blob tidak sesuai dengan ruang unggah yang diberikan.');
    }

    return blobUrl;
}

export class ClientBlobUploadService {
    async authorizeGcsUpload(
        input: AuthorizedGcsUpload,
        now = new Date(),
    ): Promise<ClientBlobUpload> {
        assertExpectedPath(input.purpose, input.pathname);
        if (!input.blobUrl.startsWith(`gs://${input.bucket}/`)) {
            throw new ValidationError('Locator Cloud Storage tidak sesuai dengan bucket upload.');
        }
        if (!Number.isSafeInteger(input.expectedSizeBytes) || input.expectedSizeBytes <= 0) {
            throw new ValidationError('Ukuran upload harus berupa bilangan bulat positif.');
        }
        const expiresAt = new Date(now.getTime() + clientBlobClaimTtlMs());
        const [inserted] = await db.insert(clientBlobUploads).values({
            id: input.id,
            blobUrl: input.blobUrl,
            pathname: input.pathname,
            provider: 'gcs',
            bucket: input.bucket,
            purpose: input.purpose,
            uploadedBy: input.uploadedBy,
            status: 'authorized',
            expectedSizeBytes: input.expectedSizeBytes,
            expectedContentType: input.expectedContentType,
            authorizedAt: now,
            expiresAt,
            // Retained for compatibility with the original non-null column;
            // finalizedAt is the authoritative GCS completion timestamp.
            completedAt: now,
            updatedAt: now,
        }).returning();
        return inserted;
    }

    async cancelGcsAuthorization(id: string, reason: string, now = new Date()): Promise<void> {
        await db.update(clientBlobUploads).set({
            status: 'deleted',
            lastCleanupError: reason.slice(0, 500),
            updatedAt: now,
        }).where(and(
            eq(clientBlobUploads.id, id),
            eq(clientBlobUploads.provider, 'gcs'),
            eq(clientBlobUploads.status, 'authorized'),
        ));
    }

    async getOwnedUpload(id: string, uploadedBy: string): Promise<ClientBlobUpload | null> {
        const [upload] = await db.select().from(clientBlobUploads).where(and(
            eq(clientBlobUploads.id, id),
            eq(clientBlobUploads.uploadedBy, uploadedBy),
        )).limit(1);
        return upload || null;
    }

    async recordGcsFinalized(
        input: FinalizedGcsUpload,
        now = new Date(),
    ): Promise<GcsFinalizationResult> {
        assertExpectedPath(input.purpose, input.pathname);
        if (!/^\d+$/.test(input.generation) || !Number.isSafeInteger(input.sizeBytes)) {
            throw new ValidationError('Metadata generasi atau ukuran Cloud Storage tidak valid.');
        }
        return db.transaction(async tx => {
            const [existing] = await tx.select().from(clientBlobUploads)
                .where(eq(clientBlobUploads.id, input.uploadId))
                .limit(1)
                .for('update');
            if (!existing) throw new ValidationError('Upload intent Cloud Storage tidak ditemukan.');
            if (
                existing.provider !== 'gcs'
                || existing.bucket !== input.bucket
                || existing.pathname !== input.pathname
                || existing.purpose !== input.purpose
                || existing.uploadedBy !== input.uploadedBy
                || existing.blobUrl !== toGcsLocator(input.bucket, input.pathname)
            ) {
                throw new ConflictError('Event Cloud Storage tidak sesuai dengan upload intent.');
            }
            // Eventarc is at-least-once. Once the exact generation has been
            // accepted, every downstream state (claimed, release cleanup,
            // cleanup in progress, and deleted included) is an idempotent
            // duplicate. The immutable upload id + locator + generation is
            // authoritative here: a delayed delivery must never delete bytes
            // already accepted, even if repeated auxiliary metadata differs.
            if (existing.objectGeneration === input.generation) {
                return { upload: existing, disposition: 'duplicate' };
            }
            if (existing.objectGeneration !== null) {
                throw new ConflictError('Upload intent sudah difinalisasi oleh object atau event lain.');
            }
            if (
                existing.expectedSizeBytes !== null
                && existing.expectedSizeBytes !== input.sizeBytes
            ) {
                throw new ConflictError('Ukuran object tidak sesuai dengan upload intent.');
            }
            if (
                existing.expectedContentType
                && existing.expectedContentType !== input.contentType
            ) {
                throw new ConflictError('Content-Type object tidak sesuai dengan upload intent.');
            }
            if (existing.status !== 'authorized' || existing.expiresAt <= now) {
                throw new ConflictError('Upload intent sudah kedaluwarsa atau tidak dapat difinalisasi.');
            }
            const [updated] = await tx.update(clientBlobUploads).set({
                status: 'pending',
                objectGeneration: input.generation,
                eventId: input.eventId,
                finalizedAt: now,
                completedAt: now,
                updatedAt: now,
            }).where(and(
                eq(clientBlobUploads.id, existing.id),
                eq(clientBlobUploads.status, 'authorized'),
            )).returning();
            if (!updated) throw new ConflictError('Upload intent berubah saat finalisasi.');
            return { upload: updated, disposition: 'finalized' };
        });
    }

    async recordCompletedUpload(
        input: CompletedClientBlobUpload,
        now = new Date(),
    ): Promise<ClientBlobUpload> {
        const blobUrl = assertCallbackOwnedLocator(input);
        const expiresAt = new Date(now.getTime() + clientBlobClaimTtlMs());
        const [inserted] = await db.insert(clientBlobUploads).values({
            blobUrl,
            pathname: input.pathname,
            purpose: input.purpose,
            uploadedBy: input.uploadedBy,
            status: 'pending',
            expiresAt,
            completedAt: now,
            updatedAt: now,
        }).onConflictDoNothing({ target: clientBlobUploads.blobUrl }).returning();

        if (inserted) return inserted;

        // Vercel may retry a signed completion callback. Exact duplicates are
        // idempotent; a mismatch for an existing URL is never allowed to
        // rewrite ownership or extend the cleanup lease.
        const [existing] = await db.select().from(clientBlobUploads)
            .where(eq(clientBlobUploads.blobUrl, blobUrl)).limit(1);
        if (
            !existing
            || existing.pathname !== input.pathname
            || existing.purpose !== input.purpose
            || existing.uploadedBy !== input.uploadedBy
        ) {
            throw new ConflictError('Callback Blob bertentangan dengan lease yang sudah tercatat.');
        }
        return existing;
    }

    async claimWithExecutor(
        executor: any,
        input: ClaimClientBlobUpload,
        entityType: 'surat_masuk' | 'surat_keluar' | 'regulatory_rule_set',
        entityId: string,
        now = new Date(),
    ): Promise<ClientBlobUpload> {
        const blobUrl = normalizeBlobLocator(input.blobUrl);
        const [claimed] = await executor.update(clientBlobUploads).set({
            status: 'claimed',
            claimedAt: now,
            claimedEntityType: entityType,
            claimedEntityId: entityId,
            updatedAt: now,
        }).where(and(
            eq(clientBlobUploads.blobUrl, blobUrl),
            eq(clientBlobUploads.purpose, input.purpose),
            eq(clientBlobUploads.uploadedBy, input.uploadedBy),
            eq(clientBlobUploads.status, 'pending'),
            gt(clientBlobUploads.expiresAt, now),
        )).returning();

        if (!claimed) {
            throw new ConflictError(
                'Lease unggahan Blob tidak ditemukan, sudah kedaluwarsa, atau bukan milik pengguna ini. Unggah ulang berkas.',
            );
        }
        return claimed;
    }

    /**
     * Read-only authorization before object-storage I/O. The expiry predicate
     * deliberately reserves enough time for the bounded preflight to finish;
     * the business transaction still performs the authoritative pending ->
     * claimed transition afterwards.
     */
    async preAuthorizeClaim(
        input: ClaimClientBlobUpload,
        minimumRemainingMs: number,
        now = new Date(),
    ): Promise<ClientBlobUpload> {
        const blobUrl = normalizeBlobLocator(input.blobUrl);
        const safeMinimumRemainingMs = Math.max(0, Math.floor(minimumRemainingMs));
        const mustRemainValidAfter = new Date(now.getTime() + safeMinimumRemainingMs);
        const [authorized] = await db
            .select()
            .from(clientBlobUploads)
            .where(and(
                eq(clientBlobUploads.blobUrl, blobUrl),
                eq(clientBlobUploads.purpose, input.purpose),
                eq(clientBlobUploads.uploadedBy, input.uploadedBy),
                eq(clientBlobUploads.status, 'pending'),
                gt(clientBlobUploads.expiresAt, mustRemainValidAfter),
            ))
            .limit(1);

        if (!authorized) {
            throw new ConflictError(
                'Lease unggahan Blob tidak ditemukan, sudah dipakai, hampir/kedaluwarsa, atau bukan milik pengguna ini. Unggah ulang berkas.',
            );
        }
        return authorized;
    }

    /**
     * Atomically reserves expired/unclaimed uploads and quarantine generations
     * that have already been promoted to the final bucket before deleting.
     * A business transaction can only claim status=pending with expiresAt>now,
     * so it can never race a deletion selected here.
     */
    async cleanupExpired(limit = 50, now = new Date()): Promise<{
        examined: number;
        deleted: number;
        failed: number;
    }> {
        const safeLimit = Math.max(1, Math.min(Math.floor(limit), 200));
        const staleBefore = new Date(now.getTime() - STALE_CLEANUP_CLAIM_MS);
        const retryEligibleAt = sql<Date>`${now} - (
            least(
                ${CLEANUP_RETRY_MAX_MS},
                ${CLEANUP_RETRY_BASE_MS} * power(2, greatest(${clientBlobUploads.cleanupAttempts} - 1, 0))
            ) * interval '1 millisecond'
        )`;
        const candidates = await db.select().from(clientBlobUploads).where(or(
            and(
                or(
                    and(
                        eq(clientBlobUploads.status, 'authorized'),
                        lte(clientBlobUploads.expiresAt, now),
                    ),
                    and(
                        eq(clientBlobUploads.status, 'pending'),
                        lte(clientBlobUploads.expiresAt, now),
                    ),
                    eq(clientBlobUploads.status, 'release_cleanup'),
                    and(
                        eq(clientBlobUploads.status, 'cleanup_started'),
                        lte(clientBlobUploads.cleanupStartedAt, staleBefore),
                    ),
                ),
                or(
                    isNull(clientBlobUploads.lastCleanupError),
                    lte(clientBlobUploads.updatedAt, retryEligibleAt),
                ),
            ),
        )).orderBy(
            asc(clientBlobUploads.cleanupAttempts),
            asc(clientBlobUploads.updatedAt),
            asc(clientBlobUploads.id),
        ).limit(safeLimit);

        let deleted = 0;
        let failed = 0;
        for (const candidate of candidates) {
            const [reserved] = await db.update(clientBlobUploads).set({
                status: 'cleanup_started',
                cleanupStartedAt: now,
                cleanupPreviousStatus: candidate.status === 'cleanup_started'
                    ? candidate.cleanupPreviousStatus
                    : candidate.status,
                cleanupAttempts: sql`${clientBlobUploads.cleanupAttempts} + 1`,
                lastCleanupError: null,
                updatedAt: now,
            }).where(and(
                eq(clientBlobUploads.id, candidate.id),
                and(
                    or(
                        and(
                            eq(clientBlobUploads.status, 'authorized'),
                            lte(clientBlobUploads.expiresAt, now),
                        ),
                        and(
                            eq(clientBlobUploads.status, 'pending'),
                            lte(clientBlobUploads.expiresAt, now),
                        ),
                        eq(clientBlobUploads.status, 'release_cleanup'),
                        and(
                            eq(clientBlobUploads.status, 'cleanup_started'),
                            lte(clientBlobUploads.cleanupStartedAt, staleBefore),
                        ),
                    ),
                    // Re-check backoff while reserving so a concurrent worker
                    // cannot immediately reclaim a row another worker failed.
                    or(
                        isNull(clientBlobUploads.lastCleanupError),
                        lte(clientBlobUploads.updatedAt, retryEligibleAt),
                    ),
                ),
            )).returning();
            if (!reserved) continue;

            if (reserved.provider === 'gcs' && !reserved.objectGeneration) {
                // An authorized resumable session has no immutable generation
                // until Eventarc finalizes it. Never delete the live object
                // name: a delayed finalize could race this cleanup. Tombstone
                // only the lease; a later event deletes its delivered exact
                // generation and bucket lifecycle covers an event that never
                // arrives.
                deleted += 1;
                await db.update(clientBlobUploads).set({
                    status: 'deleted',
                    cleanupStartedAt: null,
                    cleanupPreviousStatus: null,
                    lastCleanupError: null,
                    updatedAt: new Date(),
                }).where(and(
                    eq(clientBlobUploads.id, reserved.id),
                    eq(clientBlobUploads.status, 'cleanup_started'),
                ));
                continue;
            }

            const removed = await blobStorageService.deleteFileGeneration(
                reserved.blobUrl,
                reserved.provider === 'gcs' ? reserved.objectGeneration : null,
            );
            if (removed) {
                deleted += 1;
                await db.update(clientBlobUploads).set({
                    status: 'deleted',
                    cleanupStartedAt: null,
                    cleanupPreviousStatus: null,
                    lastCleanupError: null,
                    updatedAt: new Date(),
                }).where(and(
                    eq(clientBlobUploads.id, reserved.id),
                    eq(clientBlobUploads.status, 'cleanup_started'),
                ));
            } else {
                failed += 1;
                // Restore the durable pre-cleanup state. Unknown legacy rows
                // fall back to authorized (never claimable), not pending.
                const previousStatus = reserved.cleanupPreviousStatus;
                const retryStatus = previousStatus === 'pending'
                    || previousStatus === 'release_cleanup'
                    || previousStatus === 'authorized'
                    ? previousStatus
                    : 'authorized';
                await db.update(clientBlobUploads).set({
                    status: retryStatus,
                    cleanupStartedAt: null,
                    cleanupPreviousStatus: null,
                    lastCleanupError: 'Object storage deletion failed; retry required.',
                    updatedAt: new Date(),
                }).where(and(
                    eq(clientBlobUploads.id, reserved.id),
                    eq(clientBlobUploads.status, 'cleanup_started'),
                ));
            }
        }

        if (deleted || failed) {
            log.info({ examined: candidates.length, deleted, failed }, 'Expired client Blob reconciliation completed');
        }
        return { examined: candidates.length, deleted, failed };
    }
}

export const clientBlobUploadService = new ClientBlobUploadService();
export default clientBlobUploadService;
