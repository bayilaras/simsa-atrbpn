import { and, asc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { clientBlobUploads, type ClientBlobUpload } from '../db/schema/index.js';
import { ConflictError, ValidationError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { blobStorageService } from './blob-storage.service.js';

const log = createLogger('ClientBlobUploadService');

export type ClientBlobPurpose = 'surat_masuk' | 'surat_keluar' | 'regulatory_source' | 'arsip';

/** The signed token and finalizer both bind an archive upload to this namespace. */
export function parseArsipUploadPath(pathname: string): { arsipId: string; fileName: string } | null {
    const match = /^arsip-attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([^/\\]+\.[pP][dD][fF])$/.exec(pathname);
    // Callback names include the storage provider's random suffix. Token input
    // is capped separately at 240 so the completed immutable name still fits.
    if (!match || pathname.includes('..') || match[2].length > 512 || /[\u0000-\u001f\u007f]/.test(pathname)) return null;
    return { arsipId: match[1], fileName: match[2] };
}

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

export type ClientBlobUploadReadiness =
    | { status: 'waiting' | 'unavailable' }
    | { status: 'ready'; expiresAt: string };

const DEFAULT_CLAIM_TTL_HOURS = 24;
const MIN_CLAIM_TTL_HOURS = 1;
const MAX_CLAIM_TTL_HOURS = 168;
const STALE_CLEANUP_CLAIM_MS = 15 * 60 * 1000;
const CLEANUP_RETRY_BASE_MS = 60 * 1000;
const CLEANUP_RETRY_MAX_MS = 60 * 60 * 1000;

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
        case 'arsip': return 'arsip-attachments/';
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
    /** Callback receipt is independent of the browser SDK upload response. */
    async getReadiness(
        input: ClaimClientBlobUpload,
        now = new Date(),
    ): Promise<ClientBlobUploadReadiness> {
        const blobUrl = normalizeBlobLocator(input.blobUrl);
        let parsed: URL;
        let pathname: string;
        try {
            parsed = new URL(blobUrl);
            pathname = decodeURIComponent(parsed.pathname.slice(1));
        } catch {
            throw new ValidationError('Locator unggahan tidak valid.');
        }
        // The installed Blob SDK uses this token component as its store ID.
        // No network request or unsigned callback reconstruction is performed.
        const storeId = process.env.BLOB_READ_WRITE_TOKEN?.trim().split('_')[3];
        if (!storeId || !/^[a-z0-9]+$/i.test(storeId)) {
            throw new Error('Private Blob storage is not configured for upload status');
        }
        if (blobUrl.length > 2048 || /[\u0000-\u0020\u007f]/.test(blobUrl)
            || parsed.hostname !== `${storeId.toLowerCase()}.private.blob.vercel-storage.com`
            || parsed.port || !/\.pdf$/i.test(pathname)
            || /[\u0000-\u001f\u007f]/.test(pathname)
            || !['surat_masuk', 'surat_keluar', 'regulatory_source', 'arsip'].includes(input.purpose)) {
            throw new ValidationError('Locator unggahan tidak sesuai dengan penyimpanan atau tujuan unggahan.');
        }
        assertCallbackOwnedLocator({ ...input, blobUrl, pathname });
        const [lease] = await db.select({ status: clientBlobUploads.status, expiresAt: clientBlobUploads.expiresAt })
            .from(clientBlobUploads).where(and(
                eq(clientBlobUploads.blobUrl, blobUrl),
                eq(clientBlobUploads.purpose, input.purpose),
                eq(clientBlobUploads.uploadedBy, input.uploadedBy),
                eq(clientBlobUploads.provider, 'vercel_blob'),
            )).limit(1);
        // Never disclose another user's lease, even to a super administrator.
        if (!lease) return { status: 'waiting' };
        // Match the existing claim preflights, including the longer PDF source check.
        const minimumRemainingMs = input.purpose === 'regulatory_source' ? 10 * 60 * 1000 : 35_000;
        if (lease.status !== 'pending' || lease.expiresAt.getTime() <= now.getTime() + minimumRemainingMs) {
            return { status: 'unavailable' };
        }
        return { status: 'ready', expiresAt: lease.expiresAt.toISOString() };
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
        entityType: 'surat_masuk' | 'surat_keluar' | 'regulatory_rule_set' | 'arsip',
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
     * Atomically reserves expired/unclaimed uploads before deleting them.
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

            const removed = await blobStorageService.deleteFile(reserved.blobUrl);
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
