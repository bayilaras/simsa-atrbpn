import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { ObjectStorageAdapter } from '../storage/types.js';
import { BitstreamInspectionError, inspectBitstream, type BitstreamBaseline } from './bitstream-integrity.js';

export interface FixityConfig {
    batchSize: number;
    intervalSeconds: number;
    retrySeconds: number;
    maximumBytes: number;
    timeoutMs: number;
}

export function loadFixityConfig(source: NodeJS.ProcessEnv = process.env): FixityConfig {
    const integer = (name: string, fallback: number, min: number, max: number) => {
        const value = source[name]?.trim() ? Number(source[name]) : fallback;
        if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
        return value;
    };
    return {
        batchSize: integer('FIXITY_BATCH_SIZE', 20, 1, 100),
        intervalSeconds: integer('FIXITY_INTERVAL_SECONDS', 604800, 3600, 31536000),
        retrySeconds: integer('FIXITY_RETRY_SECONDS', 3600, 60, 86400),
        maximumBytes: integer('FIXITY_MAX_BYTES', 64 * 1024 * 1024, 1, 512 * 1024 * 1024),
        timeoutMs: integer('FIXITY_TIMEOUT_MS', 30000, 1000, 120000),
    };
}

interface ClaimedFile extends BitstreamBaseline { id: string; claimToken: string }
type Inspection = Awaited<ReturnType<typeof inspectBitstream>>;
type Outcome = 'match' | 'mismatch' | 'error' | 'stale';

/** One bounded run, intended for a scheduled worker with the worker database role. */
export class FileFixityService {
    constructor(
        private readonly pool: Pick<Pool, 'query' | 'connect'>,
        private readonly download: ObjectStorageAdapter['downloadFile'],
    ) {}

    async run(config: FixityConfig = loadFixityConfig()) {
        const summary = { checked: 0, matched: 0, mismatched: 0, failed: 0, stale: 0 };
        // Discover a bounded set of new controlled files. Existing schedules are
        // not reset by a restart, and each failed object gets a retry delay.
        await this.pool.query(`
            INSERT INTO file_fixity_jobs (attachment_id)
            SELECT f.id FROM file_attachments f
            LEFT JOIN file_fixity_jobs j ON j.attachment_id=f.id
            WHERE j.attachment_id IS NULL AND f.storage_access='private'
              AND f.malware_scan_status='clean' AND f.sha256 IS NOT NULL
              AND f.integrity_status <> 'mismatch'
            ORDER BY f.created_at, f.id LIMIT $1
            ON CONFLICT (attachment_id) DO NOTHING
        `, [config.batchSize]);

        for (let index = 0; index < config.batchSize; index++) {
            const file = await this.claim(config);
            if (!file) break;
            let inspection: Inspection | undefined;
            let errorCode: string | undefined;
            try {
                inspection = await inspectBitstream(file, this.download, config);
            } catch (error) {
                // Persist a stable code, never an SDK error containing a locator,
                // signed URL or credential. Scheduler exit status signals failure.
                errorCode = error instanceof BitstreamInspectionError ? error.code : 'READ_FAILED';
            }
            const outcome = await this.finish(file, config, inspection, errorCode);
            summary.checked++;
            if (outcome === 'match') summary.matched++;
            else if (outcome === 'mismatch') summary.mismatched++;
            else if (outcome === 'stale') summary.stale++;
            else summary.failed++;
        }
        return summary;
    }

    private async claim(config: FixityConfig): Promise<ClaimedFile | undefined> {
        const result = await this.pool.query<ClaimedFile>(`
            WITH candidate AS (
                SELECT j.attachment_id FROM file_fixity_jobs j
                JOIN file_attachments f ON f.id=j.attachment_id
                WHERE j.next_check_at <= now()
                  AND (j.claim_token IS NULL OR j.lease_expires_at <= now())
                  AND f.storage_access='private' AND f.malware_scan_status='clean'
                  AND f.sha256 IS NOT NULL AND f.integrity_status <> 'mismatch'
                ORDER BY j.next_check_at, j.attachment_id
                LIMIT 1 FOR UPDATE OF j SKIP LOCKED
            ), claimed AS (
                UPDATE file_fixity_jobs j SET claim_token=$1,
                    lease_expires_at=now()+($2::int * interval '1 second')
                FROM candidate c WHERE j.attachment_id=c.attachment_id
                RETURNING j.attachment_id,j.claim_token
            )
            SELECT f.id,f.file_url AS "fileUrl",f.drive_file_id AS "driveFileId",
                f.object_generation AS "objectGeneration",f.storage_access AS "storageAccess",
                f.sha256,f.size_bytes::float8 AS "sizeBytes",c.claim_token AS "claimToken"
            FROM claimed c JOIN file_attachments f ON f.id=c.attachment_id
        `, [randomUUID(), Math.ceil(config.timeoutMs / 1000) + 60]);
        return result.rows[0];
    }

    private async finish(file: ClaimedFile, config: FixityConfig, inspection?: Inspection, errorCode?: string): Promise<Outcome> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const lock = await client.query(`SELECT attachment_id FROM file_fixity_jobs
                WHERE attachment_id=$1 AND claim_token=$2 AND lease_expires_at > now() FOR UPDATE`,
            [file.id, file.claimToken]);
            if (!lock.rows.length) {
                await client.query('ROLLBACK');
                return 'stale';
            }
            let outcome: Outcome = inspection ? (inspection.matches ? 'match' : 'mismatch') : 'error';
            if (inspection) {
                // A hash result may update only the exact baseline that was read.
                const updated = await client.query(`UPDATE file_attachments SET
                    integrity_status=$2, last_fixity_check_at=now()
                    WHERE id=$1 AND sha256=$3 AND size_bytes=$4
                      AND file_url IS NOT DISTINCT FROM $5
                      AND drive_file_id IS NOT DISTINCT FROM $6
                      AND object_generation IS NOT DISTINCT FROM $7
                      AND storage_access='private' AND malware_scan_status='clean'
                      AND integrity_status <> 'mismatch' RETURNING id`,
                [file.id, inspection.matches ? 'verified' : 'mismatch', file.sha256,
                    file.sizeBytes, file.fileUrl, file.driveFileId, file.objectGeneration]);
                if (!updated.rows.length) outcome = 'stale';
            }
            await client.query(`UPDATE file_fixity_jobs SET
                next_check_at=now()+($3::int * interval '1 second'),
                claim_token=NULL,lease_expires_at=NULL,last_attempt_at=now(),
                last_result=$4,last_error_code=$5
                WHERE attachment_id=$1 AND claim_token=$2`,
            [file.id, file.claimToken, outcome === 'match' ? config.intervalSeconds : config.retrySeconds,
                outcome, errorCode || null]);
            await client.query(`INSERT INTO audit_log (action,entity_type,entity_id,changes)
                VALUES ('verify_integrity','file_attachment',$1,$2::jsonb)`, [file.id, JSON.stringify({
                source: 'scheduled_fixity', result: outcome, errorCode,
                expectedHash: file.sha256, actualHash: inspection?.actualHash,
                bytesRead: inspection?.bytesRead, objectGeneration: file.objectGeneration,
            })]);
            await client.query('COMMIT');
            return outcome;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
