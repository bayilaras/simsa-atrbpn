import { pool } from '../config/database.js';
import type { PoolClient } from '@neondatabase/serverless';
import { malwareScanConfig } from '../config/env.js';
import { getBlobStorageConfigurationStatus } from '../config/blob-storage.js';
import { getEmailConfigurationStatus } from '../config/email.js';
import { getSrikandiConfigurationStatus, srikandiConfig } from '../config/srikandi.js';
import type { OperationalWorker } from '../db/schema/operational-heartbeats.js';
import { blobStorageService } from './blob-storage.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ReadinessService');

type RuntimeState = 'ready' | 'not_ready' | 'disabled';

export interface HeartbeatRow {
    worker: OperationalWorker;
    status: 'running' | 'degraded' | 'stopped';
    last_seen_at: Date | string;
    details: Record<string, unknown> | null;
}

export interface ReadinessDependencies {
    probeDatabase(signal: AbortSignal): Promise<void>;
    probeBlob(signal: AbortSignal): Promise<void>;
    probeEmbeddedScanner?(signal: AbortSignal): Promise<void>;
    readHeartbeats(signal: AbortSignal): Promise<HeartbeatRow[]>;
    now(): number;
}

async function withAbortableDatabaseClient<T>(
    signal: AbortSignal,
    operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
    // Pool acquisition has its own connectionTimeoutMillis. If our shorter
    // readiness deadline wins first, a connection acquired later is still
    // observed here and destroyed before it can return to the pool.
    const client = await pool.connect();
    let released = false;
    const release = (destroy = false) => {
        if (released) return;
        released = true;
        client.release(destroy);
    };
    const abort = () => release(true);
    signal.addEventListener('abort', abort, { once: true });
    let failed = false;
    try {
        if (signal.aborted) throw new Error('readiness database operation aborted');
        return await operation(client);
    } catch (error) {
        failed = true;
        throw error;
    } finally {
        signal.removeEventListener('abort', abort);
        release(signal.aborted || failed);
    }
}

const defaultDependencies: ReadinessDependencies = {
    async probeDatabase(signal) {
        await withAbortableDatabaseClient(signal, async (client) => {
            await client.query('SELECT 1 AS ready');
        });
    },
    async probeBlob(signal) {
        await blobStorageService.listFiles('__simsa_readiness_probe__/', { abortSignal: signal });
    },
    async probeEmbeddedScanner() {
        const { malwareScanWorker } = await import('./malware-scan.worker.js');
        await malwareScanWorker.healthCheck();
    },
    async readHeartbeats(signal) {
        return withAbortableDatabaseClient(signal, async (client) => {
            const result = await client.query<HeartbeatRow>(`
                SELECT worker, status, last_seen_at, details
                FROM operational_heartbeats
                WHERE worker IN ('malware-scan', 'srikandi')
            `);
            return result.rows;
        });
    },
    now: Date.now,
};

async function timedProbe(
    dependency: 'database' | 'blob_storage' | 'malware_scanner' | 'worker_heartbeats',
    probe: (signal: AbortSignal) => Promise<void>,
    timeoutMs = 5_000,
) {
    const startedAt = Date.now();
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
        await Promise.race([
            probe(controller.signal),
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => {
                    controller.abort();
                    reject(new Error('probe timed out'));
                }, timeoutMs);
            }),
        ]);
        return { ready: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
        log.error({ err: error, dependency }, 'Readiness dependency probe failed');
        return {
            ready: false,
            latencyMs: Date.now() - startedAt,
            reason: error instanceof Error && error.message === 'probe timed out'
                ? 'probe_timeout'
                : 'probe_failed',
        };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export function evaluateWorkerReadiness(
    rows: HeartbeatRow[],
    worker: OperationalWorker,
    required: boolean,
    staleAfterMs: number,
    now: number,
) {
    if (!required) return { required: false, state: 'disabled' as RuntimeState };
    const candidates = rows
        .filter((candidate) => candidate.worker === worker)
        .map((candidate) => ({
            ...candidate,
            seenAtMs: new Date(candidate.last_seen_at).getTime(),
        }))
        .sort((left, right) => right.seenAtMs - left.seenAtMs);
    if (candidates.length === 0) {
        return { required: true, state: 'not_ready' as RuntimeState, reason: 'heartbeat_missing' };
    }
    const live = candidates.find((candidate) => (
        candidate.status === 'running'
        && Number.isFinite(candidate.seenAtMs)
        && Math.max(0, now - candidate.seenAtMs) <= staleAfterMs
    ));
    const row = live || candidates[0];
    const lastSeenAt = row.seenAtMs;
    const ageMs = Number.isFinite(lastSeenAt) ? Math.max(0, now - lastSeenAt) : Number.POSITIVE_INFINITY;
    const ready = row.status === 'running' && ageMs <= staleAfterMs;
    return {
        required: true,
        state: ready ? 'ready' as RuntimeState : 'not_ready' as RuntimeState,
        status: row.status,
        ageMs,
        details: row.details || {},
        ...(!ready ? { reason: ageMs > staleAfterMs ? 'heartbeat_stale' : `worker_${row.status}` } : {}),
    };
}

export async function collectReadiness(
    dependencies: ReadinessDependencies = defaultDependencies,
) {
    const blobConfiguration = getBlobStorageConfigurationStatus();
    const emailConfiguration = getEmailConfigurationStatus();
    const srikandiConfiguration = getSrikandiConfigurationStatus();

    const embeddedScannerRequired = malwareScanConfig.mode === 'clamav'
        && malwareScanConfig.workerEnabled
        && malwareScanConfig.worker.runtime === 'embedded';
    let heartbeatRows: HeartbeatRow[] = [];
    const [database, blobStorage, embeddedScanner, heartbeatRuntime] = await Promise.all([
        timedProbe('database', dependencies.probeDatabase),
        blobConfiguration.configured
            ? timedProbe('blob_storage', dependencies.probeBlob)
            : Promise.resolve({ ready: !blobConfiguration.required, skipped: true }),
        embeddedScannerRequired
            ? timedProbe(
                'malware_scanner',
                dependencies.probeEmbeddedScanner || defaultDependencies.probeEmbeddedScanner!,
            )
            : Promise.resolve({ ready: true, skipped: true }),
        timedProbe('worker_heartbeats', async (signal) => {
            const rows = await dependencies.readHeartbeats(signal);
            // A non-cooperative injected dependency may settle after timeout;
            // never let that late result mutate the readiness snapshot.
            if (!signal.aborted) heartbeatRows = rows;
        }),
    ]);

    const heartbeatError = heartbeatRuntime.ready
        ? null
        : heartbeatRuntime.reason || 'heartbeat query failed';

    const malwareRequired = malwareScanConfig.mode === 'clamav'
        && malwareScanConfig.workerEnabled
        && malwareScanConfig.worker.runtime === 'external';
    const malwareWorker = heartbeatError && malwareRequired
        ? { required: true, state: 'not_ready' as RuntimeState, reason: 'heartbeat_query_failed' }
        : evaluateWorkerReadiness(
            heartbeatRows,
            'malware-scan',
            malwareRequired,
            Math.max(60_000, malwareScanConfig.worker.intervalMs * 4),
            dependencies.now(),
        );
    const srikandiWorker = heartbeatError && srikandiConfig.enabled
        ? { required: true, state: 'not_ready' as RuntimeState, reason: 'heartbeat_query_failed' }
        : evaluateWorkerReadiness(
            heartbeatRows,
            'srikandi',
            srikandiConfig.enabled,
            Math.max(60_000, srikandiConfig.workerPollMs * 6),
            dependencies.now(),
        );

    const requiredReady = database.ready
        && blobStorage.ready
        && embeddedScanner.ready
        && malwareWorker.state !== 'not_ready'
        && srikandiWorker.state !== 'not_ready';
    const optionalConfigurationInvalid = emailConfiguration.validationErrors.length > 0
        || srikandiConfiguration.validationErrors.length > 0;

    return {
        status: requiredReady ? (optionalConfigurationInvalid ? 'degraded' : 'ready') : 'not_ready',
        timestamp: new Date(dependencies.now()).toISOString(),
        dependencies: {
            database,
            blobStorage: { ...blobConfiguration, runtime: blobStorage },
            malwareScanner: malwareScanConfig.mode === 'disabled'
                ? { state: 'disabled', runtime: embeddedScanner }
                : malwareScanConfig.worker.runtime === 'external'
                    ? { state: 'delegated_to_worker' }
                    : { state: embeddedScanner.ready ? 'ready' : 'not_ready', runtime: embeddedScanner },
            malwareWorker,
            srikandiWorker,
            email: emailConfiguration,
            srikandi: srikandiConfiguration,
        },
    };
}

let cachedReadiness: Awaited<ReturnType<typeof collectReadiness>> | null = null;
let cachedUntil = 0;
let readinessInFlight: Promise<Awaited<ReturnType<typeof collectReadiness>>> | null = null;

/** Coalesce load-balancer probes so they cannot amplify database/Blob traffic. */
export async function getReadiness(): Promise<Awaited<ReturnType<typeof collectReadiness>>> {
    const now = Date.now();
    if (cachedReadiness && now < cachedUntil) return cachedReadiness;
    if (readinessInFlight) return readinessInFlight;

    readinessInFlight = collectReadiness().then((result) => {
        cachedReadiness = result;
        cachedUntil = Date.now() + 5_000;
        return result;
    }).finally(() => {
        readinessInFlight = null;
    });
    return readinessInFlight;
}
