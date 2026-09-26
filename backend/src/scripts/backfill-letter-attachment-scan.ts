import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { and, asc, eq } from 'drizzle-orm';
import { db, pool } from '../config/database.js';
import { fileAttachments } from '../db/schema/index.js';
import auditLogService from '../services/audit-log.service.js';
import blobStorageService from '../services/blob-storage.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('LetterAttachmentScanBackfill');

const MAXIMUM_BYTES = 64 * 1024 * 1024;
const READ_TIMEOUT_MS = 60_000;

export type BackfillOutcome = 'queued' | 'planned' | 'unavailable' | 'size_mismatch' | 'too_large' | 'changed' | 'failed';

interface LegacyAttachment {
    id: string;
    fileUrl: string | null;
    driveFileId: string | null;
    objectGeneration: string | null;
    sizeBytes: number | null;
}

type Download = typeof blobStorageService.downloadFile;

/** Hash the stored object exactly as the scan worker will read it. */
async function hashStoredObject(file: LegacyAttachment, download: Download) {
    const locator = file.fileUrl || file.driveFileId;
    if (!locator) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
    try {
        const result = await download(locator, {
            generation: file.objectGeneration || undefined,
            abortSignal: controller.signal,
            throwOnError: true,
        });
        if (!result) return null;
        const digest = createHash('sha256');
        let bytesRead = 0;
        for await (const value of result.stream) {
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
            bytesRead += chunk.length;
            if (bytesRead > MAXIMUM_BYTES) {
                result.stream.destroy();
                return { sha256: null, bytesRead };
            }
            digest.update(chunk);
        }
        return { sha256: digest.digest('hex'), bytesRead };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Letter attachments stored on private Vercel Blob were once registered with
 * malware_scan_status='not_required' and no hash baseline, so they were served
 * without inspection. Record the baseline from the stored object and hand each
 * one to the malware-scan queue; access stays blocked until the scan releases it.
 */
export async function backfillLetterAttachmentScan(
    apply: boolean,
    download: Download = (locator, options) => blobStorageService.downloadFile(locator, options),
): Promise<Record<BackfillOutcome, number>> {
    const summary: Record<BackfillOutcome, number> = {
        queued: 0, planned: 0, unavailable: 0, size_mismatch: 0, too_large: 0, changed: 0, failed: 0,
    };
    const legacy: LegacyAttachment[] = await db.select({
        id: fileAttachments.id,
        fileUrl: fileAttachments.fileUrl,
        driveFileId: fileAttachments.driveFileId,
        objectGeneration: fileAttachments.objectGeneration,
        sizeBytes: fileAttachments.sizeBytes,
    }).from(fileAttachments)
        .where(and(
            eq(fileAttachments.malwareScanStatus, 'not_required'),
            eq(fileAttachments.storageAccess, 'private'),
        ))
        .orderBy(asc(fileAttachments.createdAt), asc(fileAttachments.id));

    for (const file of legacy) {
        let outcome: BackfillOutcome;
        try {
            const hashed = await hashStoredObject(file, download);
            if (!hashed) outcome = 'unavailable';
            else if (!hashed.sha256) outcome = 'too_large';
            else if (file.sizeBytes !== null && file.sizeBytes !== hashed.bytesRead) outcome = 'size_mismatch';
            else if (!apply) outcome = 'planned';
            else {
                const { sha256, bytesRead } = hashed;
                outcome = await db.transaction(async tx => {
                    const [changed] = await tx.update(fileAttachments).set({
                        sha256,
                        sizeBytes: bytesRead,
                        integrityStatus: 'baseline_recorded',
                        malwareScanStatus: 'not_scanned',
                    }).where(and(
                        eq(fileAttachments.id, file.id),
                        eq(fileAttachments.malwareScanStatus, 'not_required'),
                    )).returning({ id: fileAttachments.id });
                    if (!changed) return 'changed' as const;
                    await auditLogService.logActionOrThrow({
                        userEmail: 'system:letter-attachment-scan-backfill',
                        action: 'update',
                        entityType: 'file_attachment',
                        entityId: changed.id,
                        changes: {
                            fields: ['sha256', 'sizeBytes', 'integrityStatus', 'malwareScanStatus'],
                            before: { integrityStatus: 'not_required', malwareScanStatus: 'not_required' },
                            after: { integrityStatus: 'baseline_recorded', malwareScanStatus: 'not_scanned' },
                        },
                    }, tx);
                    return 'queued' as const;
                });
            }
        } catch (error) {
            // Never log the locator: private Blob URLs are access-controlled.
            log.warn({ attachmentId: file.id, err: error instanceof Error ? error.name : 'unknown' }, 'Backfill read failed');
            outcome = 'failed';
        }
        summary[outcome] += 1;
        if (outcome !== 'queued' && outcome !== 'planned') {
            log.warn({ attachmentId: file.id, outcome }, 'Letter attachment left blocked for manual review');
        }
    }
    return summary;
}

async function main(): Promise<void> {
    const apply = process.argv.includes('--apply');
    const result = await backfillLetterAttachmentScan(apply);
    log.info({ mode: apply ? 'apply' : 'dry-run', ...result }, 'Letter attachment scan backfill completed');
    if (result.failed || result.unavailable || result.size_mismatch || result.too_large) process.exitCode = 2;
}

const invokedAsScript = Boolean(
    process.argv[1]
    && import.meta.url === pathToFileURL(resolve(process.argv[1])).href,
);
if (invokedAsScript) {
    void main()
        .catch(error => {
            log.fatal({ err: error }, 'Letter attachment scan backfill failed');
            process.exitCode = 1;
        })
        .finally(async () => {
            await pool.end();
        });
}
