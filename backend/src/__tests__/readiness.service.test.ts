import { beforeEach, describe, expect, it, vi } from 'vitest';

const blobStatus = vi.fn();
const emailStatus = vi.fn();
const srikandiStatus = vi.fn();
const poolConnect = vi.fn();
const blobList = vi.fn();

vi.mock('../config/blob-storage.js', () => ({
    getBlobStorageConfigurationStatus: () => blobStatus(),
}));
vi.mock('../config/email.js', () => ({
    getEmailConfigurationStatus: () => emailStatus(),
}));
vi.mock('../config/srikandi.js', () => ({
    srikandiConfig: { enabled: false, workerPollMs: 5_000 },
    getSrikandiConfigurationStatus: () => srikandiStatus(),
}));
vi.mock('../config/env.js', () => ({
    env: { NODE_ENV: 'test' },
    malwareScanConfig: {
        mode: 'disabled',
        workerEnabled: false,
        worker: { runtime: 'external', intervalMs: 15_000 },
    },
}));
vi.mock('../config/database.js', () => ({
    pool: { connect: poolConnect },
}));
vi.mock('../services/blob-storage.service.js', () => ({
    blobStorageService: { listFiles: blobList },
}));

const { collectReadiness, evaluateWorkerReadiness } = await import('../services/readiness.service.js');

describe('collectReadiness', () => {
    beforeEach(() => {
        poolConnect.mockReset();
        blobList.mockReset();
        blobList.mockResolvedValue([]);
        blobStatus.mockReturnValue({
            provider: 'vercel-blob-private', required: true, configured: true,
            ready: true, validationErrors: [],
        });
        emailStatus.mockReturnValue({ mode: 'disabled', configured: false, ready: false, validationErrors: [] });
        srikandiStatus.mockReturnValue({ enabled: false, ready: false, validationErrors: [] });
    });

    it('reports ready only after live database and Blob probes pass', async () => {
        const result = await collectReadiness({
            probeDatabase: vi.fn().mockResolvedValue(undefined),
            probeBlob: vi.fn().mockResolvedValue(undefined),
            readHeartbeats: vi.fn().mockResolvedValue([]),
            now: () => Date.parse('2026-08-28T12:00:00.000Z'),
        });

        expect(result.status).toBe('ready');
        expect(result.dependencies.database.ready).toBe(true);
        expect(result.dependencies.blobStorage.runtime.ready).toBe(true);
    });

    it('fails readiness when the database or required Blob runtime is unreachable', async () => {
        const result = await collectReadiness({
            probeDatabase: vi.fn().mockRejectedValue(new Error('database unavailable')),
            probeBlob: vi.fn().mockRejectedValue(new Error('blob unavailable')),
            readHeartbeats: vi.fn().mockResolvedValue([]),
            now: () => Date.parse('2026-08-28T12:00:00.000Z'),
        });

        expect(result.status).toBe('not_ready');
        expect(result.dependencies.database).toMatchObject({ ready: false, reason: 'probe_failed' });
        expect(result.dependencies.blobStorage.runtime).toMatchObject({ ready: false, reason: 'probe_failed' });
    });

    it('aborts live probes when their readiness deadline expires', async () => {
        vi.useFakeTimers();
        const databaseSignals: AbortSignal[] = [];
        const blobSignals: AbortSignal[] = [];
        const resultPromise = collectReadiness({
            probeDatabase: vi.fn((signal: AbortSignal) => {
                databaseSignals.push(signal);
                return new Promise<void>(() => undefined);
            }),
            probeBlob: vi.fn((signal: AbortSignal) => {
                blobSignals.push(signal);
                return new Promise<void>(() => undefined);
            }),
            readHeartbeats: vi.fn().mockResolvedValue([]),
            now: () => Date.parse('2026-08-28T12:00:00.000Z'),
        });

        await vi.advanceTimersByTimeAsync(5_000);
        const result = await resultPromise;

        expect(databaseSignals[0]?.aborted).toBe(true);
        expect(blobSignals[0]?.aborted).toBe(true);
        expect(result.dependencies.database).toMatchObject({ ready: false, reason: 'probe_timeout' });
        expect(result.dependencies.blobStorage.runtime).toMatchObject({ ready: false, reason: 'probe_timeout' });
        vi.useRealTimers();
    });

    it('applies the same abort deadline to a hanging heartbeat read', async () => {
        vi.useFakeTimers();
        let heartbeatSignal: AbortSignal | undefined;
        const resultPromise = collectReadiness({
            probeDatabase: vi.fn().mockResolvedValue(undefined),
            probeBlob: vi.fn().mockResolvedValue(undefined),
            readHeartbeats: vi.fn((signal: AbortSignal) => {
                heartbeatSignal = signal;
                return new Promise<never>(() => undefined);
            }),
            now: () => Date.parse('2026-08-28T12:00:00.000Z'),
        });

        await vi.advanceTimersByTimeAsync(5_000);
        const result = await resultPromise;

        expect(heartbeatSignal?.aborted).toBe(true);
        // No persistent worker is enabled in this test profile, so the failed
        // optional heartbeat read is bounded but does not block API readiness.
        expect(result.status).toBe('ready');
        vi.useRealTimers();
    });

    it('destroys acquired database clients when default readiness operations time out', async () => {
        vi.useFakeTimers();
        const databaseRelease = vi.fn();
        const heartbeatRelease = vi.fn();
        poolConnect
            .mockResolvedValueOnce({
                query: vi.fn(() => new Promise<never>(() => undefined)),
                release: databaseRelease,
            })
            .mockResolvedValueOnce({
                query: vi.fn(() => new Promise<never>(() => undefined)),
                release: heartbeatRelease,
            });

        const resultPromise = collectReadiness();
        await vi.advanceTimersByTimeAsync(5_000);
        const result = await resultPromise;

        expect(result.dependencies.database).toMatchObject({ ready: false, reason: 'probe_timeout' });
        expect(databaseRelease).toHaveBeenCalledWith(true);
        expect(heartbeatRelease).toHaveBeenCalledWith(true);
        vi.useRealTimers();
    });

    it('does not call an unconfigured optional Blob store a healthy live dependency', async () => {
        blobStatus.mockReturnValue({
            provider: 'vercel-blob-private', required: false, configured: false,
            ready: false, validationErrors: [],
        });
        const probeBlob = vi.fn();
        const result = await collectReadiness({
            probeDatabase: vi.fn().mockResolvedValue(undefined),
            probeBlob,
            readHeartbeats: vi.fn().mockResolvedValue([]),
            now: () => Date.parse('2026-08-28T12:00:00.000Z'),
        });

        expect(result.status).toBe('ready');
        expect(result.dependencies.blobStorage.runtime).toEqual({ ready: true, skipped: true });
        expect(probeBlob).not.toHaveBeenCalled();
    });

    it('fails before probing Blob when required storage configuration is invalid', async () => {
        blobStatus.mockReturnValue({
            provider: 'vercel-blob-private', required: true, configured: true,
            ready: false, validationErrors: ['VERCEL_BLOB_CALLBACK_URL is invalid'],
        });
        const probeBlob = vi.fn().mockResolvedValue(undefined);
        const result = await collectReadiness({
            probeDatabase: vi.fn().mockResolvedValue(undefined),
            probeBlob,
            readHeartbeats: vi.fn().mockResolvedValue([]),
            now: () => Date.parse('2026-08-28T12:00:00.000Z'),
        });

        expect(result.status).toBe('not_ready');
        expect(result.dependencies.blobStorage.runtime).toEqual({
            ready: false,
            skipped: true,
            reason: 'configuration_invalid',
        });
        expect(probeBlob).not.toHaveBeenCalled();
    });

    it('requires a fresh running heartbeat for an enabled persistent worker', () => {
        const now = Date.parse('2026-08-28T12:00:00.000Z');
        expect(evaluateWorkerReadiness([], 'malware-scan', true, 60_000, now))
            .toMatchObject({ state: 'not_ready', reason: 'heartbeat_missing' });

        const fresh = evaluateWorkerReadiness([{
            worker: 'malware-scan',
            status: 'running',
            last_seen_at: new Date(now - 10_000),
            details: { scanner: 'reachable' },
        }], 'malware-scan', true, 60_000, now);
        expect(fresh).toMatchObject({ state: 'ready', ageMs: 10_000 });

        const stale = evaluateWorkerReadiness([{
            worker: 'malware-scan',
            status: 'running',
            last_seen_at: new Date(now - 70_000),
            details: null,
        }], 'malware-scan', true, 60_000, now);
        expect(stale).toMatchObject({ state: 'not_ready', reason: 'heartbeat_stale' });

        const queueFailure = evaluateWorkerReadiness([{
            worker: 'malware-scan',
            status: 'degraded',
            last_seen_at: new Date(now - 5_000),
            details: { scanner: 'reachable', queue: 'failed' },
        }], 'malware-scan', true, 60_000, now);
        expect(queueFailure).toMatchObject({
            state: 'not_ready',
            reason: 'worker_degraded',
            details: { scanner: 'reachable', queue: 'failed' },
        });
    });
});
