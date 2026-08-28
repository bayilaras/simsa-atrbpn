import { and, eq, gt, lte, or, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { clientBlobUploads, type ClientBlobUpload } from '../db/schema/index.js';
import { ConflictError, ValidationError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { blobStorageService } from './blob-storage.service.js';

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

const DEFAULT_CLAIM_TTL_HOURS = 24;
const MIN_CLAIM_TTL_HOURS = 1;
const MAX_CLAIM_TTL_HOURS = 168;
const STALE_CLEANUP_CLAIM_MS = 15 * 60 * 1000;

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
     * Atomically reserves expired, unclaimed callback rows before deleting.
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
        const candidates = await db.select().from(clientBlobUploads).where(or(
            and(
                eq(clientBlobUploads.status, 'pending'),
                lte(clientBlobUploads.expiresAt, now),
            ),
            and(
                eq(clientBlobUploads.status, 'cleanup_started'),
                lte(clientBlobUploads.cleanupStartedAt, staleBefore),
            ),
        )).limit(safeLimit);

        let deleted = 0;
        let failed = 0;
        for (const candidate of candidates) {
            const [reserved] = await db.update(clientBlobUploads).set({
                status: 'cleanup_started',
                cleanupStartedAt: now,
                cleanupAttempts: sql`${clientBlobUploads.cleanupAttempts} + 1`,
                lastCleanupError: null,
                updatedAt: now,
            }).where(and(
                eq(clientBlobUploads.id, candidate.id),
                or(
                    and(
                        eq(clientBlobUploads.status, 'pending'),
                        lte(clientBlobUploads.expiresAt, now),
                    ),
                    and(
                        eq(clientBlobUploads.status, 'cleanup_started'),
                        lte(clientBlobUploads.cleanupStartedAt, staleBefore),
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
                    lastCleanupError: null,
                    updatedAt: new Date(),
                }).where(and(
                    eq(clientBlobUploads.id, reserved.id),
                    eq(clientBlobUploads.status, 'cleanup_started'),
                ));
            } else {
                failed += 1;
                // Return to expired pending so a later run can retry. It still
                // cannot be claimed because expiresAt has already passed.
                await db.update(clientBlobUploads).set({
                    status: 'pending',
                    cleanupStartedAt: null,
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
