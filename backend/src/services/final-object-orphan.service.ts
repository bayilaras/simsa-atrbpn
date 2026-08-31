import { pool } from '../config/database.js';
import { GcsStorageAdapter } from '../storage/gcs.adapter.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('FinalObjectOrphanReconciler');

export type FinalObjectOrphanTerminalStatus =
    | 'deleted'
    | 'referenced'
    | 'not_found'
    | 'identity_mismatch'
    | 'retry'
    | 'failed';

export interface ClaimedFinalObjectOrphan {
    id: string;
    attachmentId: string;
    candidateKind: 'scanner_promotion' | 'api_final';
    cleanupToken: string | null;
    finalLocator: string;
    finalObjectGeneration: string | null;
    sourceLocator: string | null;
    sourceObjectGeneration: string | null;
    attempts: number;
}

export interface FinalObjectOrphanRepository {
    claimNext(
        staleBefore: Date,
        maxAttempts: number,
        eligibleCreatedBefore: Date,
    ): Promise<ClaimedFinalObjectOrphan | null>;
    hasLiveReference(job: ClaimedFinalObjectOrphan): Promise<boolean>;
    complete(
        job: ClaimedFinalObjectOrphan,
        status: FinalObjectOrphanTerminalStatus,
        error?: string,
        retryAt?: Date,
    ): Promise<boolean>;
}

export interface FinalObjectOrphanDeleter {
    deleteCandidate(job: ClaimedFinalObjectOrphan): Promise<
        'deleted' | 'not_found' | 'identity_mismatch'
    >;
}

interface ClaimedRow {
    id: string;
    attachment_id: string;
    candidate_kind: 'scanner_promotion' | 'api_final';
    cleanup_token: string | null;
    final_locator: string;
    final_object_generation: string | null;
    source_locator: string | null;
    source_object_generation: string | null;
    attempts: number;
}

export class PostgresFinalObjectOrphanRepository implements FinalObjectOrphanRepository {
    async claimNext(
        staleBefore: Date,
        maxAttempts: number,
        eligibleCreatedBefore: Date,
    ): Promise<ClaimedFinalObjectOrphan | null> {
        const result = await pool.query<ClaimedRow>(`
            WITH candidate AS (
                SELECT id
                FROM final_object_orphans
                WHERE created_at <= $3
                  AND (
                    (
                      status IN ('reserved', 'pending', 'retry', 'reference_check')
                      AND attempts < $2
                      AND not_before <= now()
                    )
                    -- A process can die after incrementing the final permitted
                    -- attempt but before it records the idempotent GCS result.
                    -- Stale deleting claims therefore remain recoverable even
                    -- when their attempt budget is exhausted. The increment
                    -- below is a fencing epoch so a late prior worker cannot
                    -- conditionally complete the newly recovered claim.
                    OR (status = 'deleting' AND cleanup_started_at <= $1)
                  )
                ORDER BY not_before ASC, created_at ASC, id ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE final_object_orphans AS orphan
            SET status = 'deleting',
                cleanup_started_at = now(),
                attempts = orphan.attempts + 1,
                updated_at = now(),
                last_error = NULL
            FROM candidate
            WHERE orphan.id = candidate.id
            RETURNING
                orphan.id,
                orphan.attachment_id,
                orphan.candidate_kind,
                orphan.cleanup_token,
                orphan.final_locator,
                orphan.final_object_generation,
                orphan.source_locator,
                orphan.source_object_generation,
                orphan.attempts
        `, [staleBefore, maxAttempts, eligibleCreatedBefore]);
        const row = result.rows[0];
        return row ? {
            id: row.id,
            attachmentId: row.attachment_id,
            candidateKind: row.candidate_kind,
            cleanupToken: row.cleanup_token,
            finalLocator: row.final_locator,
            finalObjectGeneration: row.final_object_generation,
            sourceLocator: row.source_locator,
            sourceObjectGeneration: row.source_object_generation,
            attempts: row.attempts,
        } : null;
    }

    async hasLiveReference(job: ClaimedFinalObjectOrphan): Promise<boolean> {
        const result = await pool.query<{ referenced: boolean }>(`
            SELECT (
                EXISTS (
                    SELECT 1 FROM file_attachments
                    WHERE file_url = $1 AND object_generation = $2
                )
                OR EXISTS (
                    SELECT 1 FROM regulatory_rule_sets
                    WHERE source_document_blob_url = $1
                      AND source_document_object_generation = $2
                )
                OR EXISTS (
                    SELECT 1 FROM bulk_upload_items
                    WHERE blob_url = $1 AND object_generation = $2
                )
                OR EXISTS (
                    SELECT 1 FROM autentikasi
                    WHERE file_lampiran = $1 AND file_lampiran_object_generation = $2
                )
                OR EXISTS (
                    SELECT 1 FROM surat_masuk
                    WHERE file_path IN ($1, concat('blob:', $1::text))
                )
                OR EXISTS (
                    SELECT 1 FROM surat_keluar
                    WHERE file_path IN ($1, concat('blob:', $1::text))
                )
            ) AS referenced
        `, [job.finalLocator, job.finalObjectGeneration]);
        return result.rows[0]?.referenced === true;
    }

    async complete(
        job: ClaimedFinalObjectOrphan,
        status: FinalObjectOrphanTerminalStatus,
        error?: string,
        retryAt?: Date,
    ): Promise<boolean> {
        const result = await pool.query(`
            UPDATE final_object_orphans
            SET status = $3,
                not_before = CASE WHEN $3 = 'retry' THEN $5 ELSE not_before END,
                cleanup_started_at = NULL,
                last_error = $4,
                updated_at = now()
            WHERE id = $1
              AND status = 'deleting'
              AND attempts = $2
            RETURNING id
        `, [job.id, job.attempts, status, error || null, retryAt || null]);
        return result.rows.length === 1;
    }
}

export class GcsFinalObjectOrphanDeleter implements FinalObjectOrphanDeleter {
    constructor(private readonly storage = GcsStorageAdapter.fromEnvironment()) {}

    deleteCandidate(job: ClaimedFinalObjectOrphan) {
        if (job.candidateKind === 'api_final') {
            if (!job.cleanupToken) {
                throw new Error('API final-object orphan is missing its cleanup token');
            }
            return this.storage.deleteApiFinalOrphan({
                locator: job.finalLocator,
                generation: job.finalObjectGeneration,
                ownerId: job.attachmentId,
                cleanupToken: job.cleanupToken,
            });
        }
        if (!job.finalObjectGeneration || !job.sourceLocator || !job.sourceObjectGeneration) {
            throw new Error('Scanner-promoted orphan is missing its immutable source identity');
        }
        return this.storage.deletePromotedOrphan({
            locator: job.finalLocator,
            generation: job.finalObjectGeneration,
            attachmentId: job.attachmentId,
            sourceLocator: job.sourceLocator,
            sourceGeneration: job.sourceObjectGeneration,
        });
    }
}

export interface FinalObjectOrphanReconcilerOptions {
    repository: FinalObjectOrphanRepository;
    deleter: FinalObjectOrphanDeleter;
    staleAfterMs?: number;
    maxAttempts?: number;
    retryBaseMs?: number;
    retryMaxMs?: number;
    minimumObjectAgeMs?: number;
    now?: () => Date;
}

export interface FinalObjectOrphanReconciliationResult {
    inspected: number;
    deleted: number;
    referenced: number;
    missing: number;
    identityMismatch: number;
    retried: number;
    failed: number;
    staleClaims: number;
}

export class FinalObjectOrphanReconciler {
    private readonly staleAfterMs: number;
    private readonly maxAttempts: number;
    private readonly retryBaseMs: number;
    private readonly retryMaxMs: number;
    private readonly minimumObjectAgeMs: number;
    private readonly now: () => Date;

    constructor(private readonly options: FinalObjectOrphanReconcilerOptions) {
        this.staleAfterMs = options.staleAfterMs ?? 15 * 60_000;
        this.maxAttempts = options.maxAttempts ?? 10;
        this.retryBaseMs = options.retryBaseMs ?? 60_000;
        this.retryMaxMs = options.retryMaxMs ?? 6 * 60 * 60_000;
        this.minimumObjectAgeMs = options.minimumObjectAgeMs ?? 31 * 24 * 60 * 60_000;
        this.now = options.now ?? (() => new Date());
        if (!Number.isSafeInteger(this.minimumObjectAgeMs) || this.minimumObjectAgeMs < 24 * 60 * 60_000) {
            throw new Error('Final orphan minimum object age must be at least one day');
        }
    }

    private retryAt(attempt: number): Date {
        const delay = Math.min(
            this.retryBaseMs * (2 ** Math.max(0, attempt - 1)),
            this.retryMaxMs,
        );
        return new Date(this.now().getTime() + delay);
    }

    async run(limit = 100): Promise<FinalObjectOrphanReconciliationResult> {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
            throw new Error('Final orphan cleanup batch size must be between 1 and 1000');
        }
        const result: FinalObjectOrphanReconciliationResult = {
            inspected: 0,
            deleted: 0,
            referenced: 0,
            missing: 0,
            identityMismatch: 0,
            retried: 0,
            failed: 0,
            staleClaims: 0,
        };

        for (let index = 0; index < limit; index += 1) {
            const staleBefore = new Date(this.now().getTime() - this.staleAfterMs);
            const eligibleCreatedBefore = new Date(this.now().getTime() - this.minimumObjectAgeMs);
            const job = await this.options.repository.claimNext(
                staleBefore,
                this.maxAttempts,
                eligibleCreatedBefore,
            );
            if (!job) break;
            result.inspected += 1;

            try {
                if (await this.options.repository.hasLiveReference(job)) {
                    if (await this.options.repository.complete(job, 'referenced')) result.referenced += 1;
                    else result.staleClaims += 1;
                    continue;
                }

                const deletion = await this.options.deleter.deleteCandidate(job);
                const status = deletion === 'not_found' ? 'not_found' : deletion;
                if (!await this.options.repository.complete(job, status)) {
                    result.staleClaims += 1;
                    continue;
                }
                if (deletion === 'deleted') result.deleted += 1;
                else if (deletion === 'not_found') result.missing += 1;
                else result.identityMismatch += 1;
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown final cleanup error';
                const exhausted = job.attempts >= this.maxAttempts;
                const status = exhausted ? 'failed' : 'retry';
                const completed = await this.options.repository.complete(
                    job,
                    status,
                    message.slice(0, 2_000),
                    exhausted ? undefined : this.retryAt(job.attempts),
                );
                if (!completed) result.staleClaims += 1;
                else if (exhausted) result.failed += 1;
                else result.retried += 1;
                log.error({ err: error, orphanId: job.id, exhausted }, 'Final object orphan cleanup failed');
            }
        }
        return result;
    }
}
