import { validateEnv } from '../config/env.js';
import { srikandiConfig } from '../config/srikandi.js';
import { pool } from '../config/database.js';
import { srikandiWorker } from '../services/srikandi.worker.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SrikandiWorkerEntrypoint');
let shutdownRequested = false;

async function requestShutdown(signal: string): Promise<void> {
    if (shutdownRequested) return;
    shutdownRequested = true;
    log.info({ signal }, 'Stopping persistent SRIKANDI worker');
    await srikandiWorker.stop();
}

process.once('SIGTERM', () => { void requestShutdown('SIGTERM'); });
process.once('SIGINT', () => { void requestShutdown('SIGINT'); });

async function main(): Promise<void> {
    try {
        validateEnv();
        if (!srikandiConfig.enabled || !srikandiConfig.ready) {
            throw new Error('SRIKANDI worker requires an enabled and fully validated integration configuration');
        }
        await srikandiWorker.start();
    } finally {
        await pool.end();
    }
}

void main().catch((error) => {
    log.fatal({ err: error }, 'Persistent SRIKANDI worker terminated');
    process.exitCode = 1;
});
