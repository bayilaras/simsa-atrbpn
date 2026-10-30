import { assertValidBlobStorageEnvironment } from '../config/blob-storage.js';
import {
    assertGcpIamDatabaseRuntimeEnvironment,
    assertValidCloudPlatformEnvironment,
    buildCloudPlatformConfig,
} from '../config/cloud-platform.js';
import { buildDatabasePoolConfig, pool } from '../config/database.js';
import { clientBlobClaimTtlMs, clientBlobUploadService } from '../services/client-blob-upload.service.js';
import { bulkUploadService } from '../services/bulk-upload.service.js';
import { createLogger } from '../utils/logger.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const log = createLogger('ClientBlobReconciliationWorker');

export async function runBlobReconciliation() {
    buildDatabasePoolConfig(process.env);
    const cloud = buildCloudPlatformConfig(process.env);
    if (cloud.storageProvider === 'gcs') {
        const validated = assertValidCloudPlatformEnvironment(process.env, { requireAuth: false });
        assertGcpIamDatabaseRuntimeEnvironment(process.env, validated.projectId);
    } else {
        assertValidBlobStorageEnvironment({
            ...process.env,
            // This one-shot worker always needs storage even outside an API
            // production profile, so require the dependency explicitly.
            NODE_ENV: 'production',
        }, { requireCallbackUrl: false });
    }
    clientBlobClaimTtlMs(process.env);

    const batchSize = Number(process.env.CLIENT_BLOB_RECONCILE_BATCH_SIZE || 100);
    const clientUploads = await clientBlobUploadService.cleanupExpired(batchSize);
    const bulkUploads = await bulkUploadService.cleanupOldBatches();
    return { clientUploads, bulkUploads };
}

export function hasBlobReconciliationFailures(
    result: Awaited<ReturnType<typeof runBlobReconciliation>>,
): boolean {
    return result.clientUploads.failed > 0 || result.bulkUploads.blobsFailed > 0;
}

export async function main(): Promise<void> {
    try {
        const result = await runBlobReconciliation();
        log.info(result, 'Blob reconciliation run completed');
        if (hasBlobReconciliationFailures(result)) process.exitCode = 1;
    } catch (error) {
        log.fatal({ err: error }, 'Client Blob reconciliation failed');
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

const invokedAsScript = Boolean(
    process.argv[1]
    && import.meta.url === pathToFileURL(resolve(process.argv[1])).href,
);
if (invokedAsScript) void main();
