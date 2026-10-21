import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import router from '../routes/operations.routes.js';

const io = vi.hoisted(() => ({ measure: vi.fn(), storage: vi.fn() }));
vi.mock('../services/readiness.service.js', () => ({ getReadiness: vi.fn() }));
vi.mock('../services/malware-scan-dispatch.service.js', () => ({ scheduleMalwareScanWake: vi.fn() }));
vi.mock('../services/operations-status.service.js', () => ({ getOperationsStatus: vi.fn() }));
vi.mock('../config/database.js', () => ({ pool: { totalCount: 0, idleCount: 0, waitingCount: 0 } }));
vi.mock('../config/blob-storage.js', () => ({ getObjectStorageConfigurationStatus: io.storage }));
vi.mock('../services/storage-latency.service.js', () => ({ measureStorageLatency: io.measure, vercelBlobLatencyClient: { client: 'blob' } }));

const token = 'x'.repeat(64);
const app = express();
app.use('/api/operations', router);
const probe = () => request(app).post('/api/operations/storage-latency').set('Authorization', `Bearer ${token}`);
const measurement = { rounds: 3, listMs: { median: 30, samples: [30, 30, 30] }, sizes: [] };

describe('POST /api/operations/storage-latency', () => {
    beforeEach(() => {
        vi.stubEnv('OPERATIONS_MONITOR_TOKEN', token);
        vi.stubEnv('VERCEL_REGION', 'sin1');
        io.storage.mockReset().mockReturnValue({ provider: 'vercel-blob-private', ready: true });
        io.measure.mockReset().mockResolvedValue(measurement);
    });
    afterEach(() => vi.unstubAllEnvs());

    it('requires the dedicated monitor token before touching storage', async () => {
        await request(app).post('/api/operations/storage-latency').expect(401);
        await request(app).post('/api/operations/storage-latency').set('Authorization', 'Bearer wrong').expect(401);
        // Only POST measures; GET falls through to the session-authenticated routes.
        expect((await request(app).get('/api/operations/storage-latency').set('Authorization', `Bearer ${token}`)).status).not.toBe(200);
        expect(io.measure).not.toHaveBeenCalled();
    });

    it('measures 16 KiB and 1 MiB probes three times from the function region without caching', async () => {
        const response = await probe().expect(200);
        expect(response.body).toEqual({ status: 'measured', provider: 'vercel-blob-private', functionRegion: 'sin1', ...measurement });
        expect(response.headers['cache-control']).toBe('no-store');
        expect(io.measure).toHaveBeenCalledExactlyOnceWith({ client: 'blob' }, { sizes: [16 * 1024, 1024 * 1024], rounds: 3 });
    });

    it('does not probe storage that is not private Vercel Blob', async () => {
        io.storage.mockReturnValue({ provider: 'google-cloud-storage-private', ready: true });
        expect((await probe().expect(200)).body).toEqual({ status: 'not_supported' });
        io.storage.mockReturnValue({ provider: 'vercel-blob-private', ready: false });
        expect((await probe().expect(200)).body).toEqual({ status: 'not_supported' });
        expect(io.measure).not.toHaveBeenCalled();
    });

    it('reports a failed probe without provider details', async () => {
        io.measure.mockRejectedValue(new Error('private token detail'));
        const response = await probe().expect(503);
        expect(response.body).toEqual({ status: 'failed' });
    });

    it('runs one measurement at a time per instance', async () => {
        let release!: () => void;
        io.measure.mockImplementation(() => new Promise(resolve => { release = () => resolve(measurement); }));
        const first = probe().then(response => response);
        await vi.waitFor(() => expect(io.measure).toHaveBeenCalledOnce());
        expect((await probe().expect(429)).body).toEqual({ status: 'busy' });
        release();
        expect((await first).status).toBe(200);
    });
});
