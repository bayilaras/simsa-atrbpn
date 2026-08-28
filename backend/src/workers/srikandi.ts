import { validateRuntimeEnv } from '../config/env.js';
import { pool } from '../config/database.js';
import { srikandiWorker } from '../services/srikandi.worker.js';
import { OperationalHeartbeatService } from '../services/operational-heartbeat.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SrikandiWorkerEntrypoint');
let shutdownRequested = false;
let heartbeatTimer: NodeJS.Timeout | null = null;
const heartbeat = new OperationalHeartbeatService('srikandi');

async function requestShutdown(signal: string): Promise<void> {
    if (shutdownRequested) return;
    shutdownRequested = true;
    log.info({ signal }, 'Stopping persistent SRIKANDI worker');
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    await srikandiWorker.stop();
}

process.once('SIGTERM', () => { void requestShutdown('SIGTERM'); });
process.once('SIGINT', () => { void requestShutdown('SIGINT'); });

async function main(): Promise<void> {
    try {
        validateRuntimeEnv('srikandi-worker');
        await heartbeat.record('running', srikandiWorker.healthSnapshot());
        heartbeatTimer = setInterval(() => {
            const snapshot = srikandiWorker.healthSnapshot();
            void heartbeat.record(
                snapshot.cycleHealthy ? 'running' : 'degraded',
                snapshot,
            ).catch((error) => {
                log.fatal({ err: error }, 'SRIKANDI worker heartbeat could not be persisted');
                process.exitCode = 1;
                void requestShutdown('heartbeat_failure');
            });
        }, Math.max(10_000, Math.min(30_000, Number(process.env.SRIKANDI_WORKER_POLL_MS) || 5_000)));
        heartbeatTimer.unref();
        await srikandiWorker.start();
    } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        await heartbeat.record('stopped', srikandiWorker.healthSnapshot()).catch((error) => {
            log.error({ err: error }, 'Could not persist stopped SRIKANDI heartbeat');
        });
        await pool.end();
    }
}

void main().catch((error) => {
    log.fatal({ err: error }, 'Persistent SRIKANDI worker terminated');
    process.exitCode = 1;
});
