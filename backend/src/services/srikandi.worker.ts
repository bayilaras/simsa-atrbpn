import { srikandiConfig, type SrikandiConfig } from '../config/srikandi.js';
import { createLogger } from '../utils/logger.js';
import {
    SrikandiIntegrationUnavailableError,
    srikandiService,
    type SrikandiDispatchResult,
} from './srikandi.service.js';

const log = createLogger('SrikandiWorker');

export interface SrikandiDispatchServiceLike {
    dispatchDue(
        unitScope: null,
        limit: number,
        actorUserId?: string,
    ): Promise<SrikandiDispatchResult[]>;
}

function waitForNextCycle(durationMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setTimeout(finish, durationMs);
        function finish() {
            clearTimeout(timer);
            signal.removeEventListener('abort', finish);
            resolve();
        }
        signal.addEventListener('abort', finish, { once: true });
    });
}

/**
 * Persistent outbox consumer. Multiple instances are safe: the service uses a
 * conditional database claim and per-attempt lease before any HTTP delivery.
 */
export class SrikandiWorker {
    private stopController: AbortController | null = null;
    private runningPromise: Promise<void> | null = null;

    constructor(
        private readonly service: SrikandiDispatchServiceLike = srikandiService,
        private readonly config: SrikandiConfig = srikandiConfig,
    ) {}

    async runOnce(): Promise<SrikandiDispatchResult[]> {
        if (!this.config.enabled || !this.config.ready) {
            throw new SrikandiIntegrationUnavailableError(
                'Worker SRIKANDI menolak berjalan karena konfigurasi resmi belum lengkap',
            );
        }
        return this.service.dispatchDue(null, this.config.workerBatchSize);
    }

    start(): Promise<void> {
        if (this.runningPromise) return this.runningPromise;
        if (!this.config.enabled || !this.config.ready) {
            return Promise.reject(new SrikandiIntegrationUnavailableError(
                'Worker SRIKANDI menolak berjalan karena konfigurasi resmi belum lengkap',
            ));
        }

        this.stopController = new AbortController();
        const signal = this.stopController.signal;
        this.runningPromise = this.runLoop(signal).finally(() => {
            this.runningPromise = null;
            this.stopController = null;
        });
        return this.runningPromise;
    }

    async stop(): Promise<void> {
        this.stopController?.abort();
        await this.runningPromise;
    }

    private async runLoop(signal: AbortSignal): Promise<void> {
        log.info({
            batchSize: this.config.workerBatchSize,
            pollMs: this.config.workerPollMs,
        }, 'Persistent SRIKANDI worker started');

        while (!signal.aborted) {
            let processed = 0;
            try {
                const results = await this.runOnce();
                processed = results.length;
                if (processed > 0) {
                    log.info({
                        processed,
                        synchronized: results.filter(result => result.outcome === 'succeeded').length,
                        retryScheduled: results.filter(result => result.outcome === 'retry_scheduled').length,
                        deadLettered: results.filter(result => result.outcome === 'dead_letter').length,
                    }, 'SRIKANDI outbox cycle completed');
                }
            } catch (error) {
                // A cycle failure must not terminate the persistent worker. No
                // row is reported as synchronized unless its transactional
                // official-ACK finalization has already succeeded.
                log.error({ err: error }, 'SRIKANDI worker cycle failed');
            }

            const delay = processed >= this.config.workerBatchSize
                ? 50
                : this.config.workerPollMs;
            await waitForNextCycle(delay, signal);
        }

        log.info('Persistent SRIKANDI worker stopped');
    }
}

export const srikandiWorker = new SrikandiWorker();
