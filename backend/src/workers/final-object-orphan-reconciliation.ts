import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    assertGcpIamDatabaseRuntimeEnvironment,
    assertValidCloudPlatformEnvironment,
} from '../config/cloud-platform.js';
import { buildDatabasePoolConfig, pool } from '../config/database.js';
import { loadFinalObjectRetentionPolicy } from '../config/final-object-retention.js';
import {
    FinalObjectOrphanReconciler,
    GcsFinalObjectOrphanDeleter,
    PostgresFinalObjectOrphanRepository,
} from '../services/final-object-orphan.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('FinalObjectOrphanCleanupJob');

function boundedInteger(name: string, fallback: number, min: number, max: number): number {
    const value = Number(process.env[name] || fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max}`);
    }
    return value;
}

export async function runFinalObjectOrphanCleanup() {
    buildDatabasePoolConfig(process.env);
    const cloud = assertValidCloudPlatformEnvironment(process.env, { requireAuth: false });
    assertGcpIamDatabaseRuntimeEnvironment(process.env, cloud.projectId);
    if (process.env.OBJECT_STORAGE_PROVIDER !== 'gcs') {
        throw new Error('Final object orphan cleanup requires OBJECT_STORAGE_PROVIDER=gcs');
    }
    const retention = loadFinalObjectRetentionPolicy(process.env, { requireExplicit: true });

    const reconciler = new FinalObjectOrphanReconciler({
        repository: new PostgresFinalObjectOrphanRepository(),
        deleter: new GcsFinalObjectOrphanDeleter(),
        staleAfterMs: boundedInteger('FINAL_ORPHAN_STALE_AFTER_MS', 900_000, 60_000, 86_400_000),
        maxAttempts: boundedInteger('FINAL_ORPHAN_MAX_ATTEMPTS', 10, 1, 100),
        retryBaseMs: boundedInteger('FINAL_ORPHAN_RETRY_BASE_MS', 60_000, 1_000, 86_400_000),
        retryMaxMs: boundedInteger('FINAL_ORPHAN_RETRY_MAX_MS', 21_600_000, 1_000, 604_800_000),
        minimumObjectAgeMs: retention.minimumAgeMs,
    });
    return reconciler.run(boundedInteger('FINAL_ORPHAN_BATCH_SIZE', 100, 1, 1_000));
}

async function shutdownCloudSqlProxy(): Promise<void> {
    const configured = process.env.CLOUD_SQL_PROXY_SHUTDOWN_URL?.trim();
    if (!configured) return;
    const target = new URL(configured);
    if (
        target.protocol !== 'http:'
        || target.hostname !== '127.0.0.1'
        || target.port !== '9091'
        || target.pathname !== '/quitquitquit'
        || target.username
        || target.password
        || target.search
        || target.hash
    ) {
        throw new Error('CLOUD_SQL_PROXY_SHUTDOWN_URL must be the fixed loopback admin endpoint');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
        const response = await fetch(target, { method: 'POST', signal: controller.signal });
        if (!response.ok) {
            throw new Error(`Cloud SQL Proxy shutdown returned HTTP ${response.status}`);
        }
    } finally {
        clearTimeout(timer);
    }
}

export async function main(): Promise<void> {
    try {
        const result = await runFinalObjectOrphanCleanup();
        log.info(result, 'Final object orphan cleanup completed');
        if (result.failed > 0 || result.identityMismatch > 0 || result.staleClaims > 0) {
            process.exitCode = 1;
        }
    } catch (error) {
        log.fatal({ err: error }, 'Final object orphan cleanup job failed');
        process.exitCode = 1;
    } finally {
        await pool.end();
        try {
            await shutdownCloudSqlProxy();
        } catch (error) {
            log.error({ err: error }, 'Could not stop the Cloud SQL Proxy sidecar');
            process.exitCode = 1;
        }
    }
}

const invokedAsScript = Boolean(
    process.argv[1]
    && import.meta.url === pathToFileURL(resolve(process.argv[1])).href,
);
if (invokedAsScript) void main();
