import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import router from '../routes/operations.routes.js';

const io = vi.hoisted(() => ({ cleanup: vi.fn(), storage: vi.fn() }));
vi.mock('../services/readiness.service.js', () => ({ getReadiness: vi.fn() }));
vi.mock('../services/malware-scan-dispatch.service.js', () => ({ scheduleMalwareScanWake: vi.fn() }));
vi.mock('../services/operations-status.service.js', () => ({ getOperationsStatus: vi.fn() }));
vi.mock('../config/database.js', () => ({ pool: { totalCount: 0, idleCount: 0, waitingCount: 0 } }));
vi.mock('../config/blob-storage.js', () => ({ getObjectStorageConfigurationStatus: io.storage }));
vi.mock('../services/client-blob-upload.service.js', () => ({ clientBlobUploadService: { cleanupExpired: io.cleanup } }));
// Session-authenticated routes after the bearer endpoints: reject without a session lookup.
vi.mock('../middlewares/auth.middleware.js', () => ({ authMiddleware: (_req: unknown, res: { status(code: number): { json(body: unknown): void } }) => res.status(401).json({}) }));
vi.mock('../middlewares/role.middleware.js', () => ({ roleMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next() }));

const secret = 'c'.repeat(48);
const app = express();
app.use('/api/operations', router);
const cron = () => request(app).get('/api/operations/upload-reconcile').set('Authorization', `Bearer ${secret}`);

describe('GET /api/operations/upload-reconcile (Vercel Cron)', () => {
    beforeEach(() => {
        vi.stubEnv('CRON_SECRET', secret);
        vi.stubEnv('OPERATIONS_MONITOR_TOKEN', 'x'.repeat(64));
        io.storage.mockReset().mockReturnValue({ provider: 'vercel-blob-private', ready: true });
        io.cleanup.mockReset().mockResolvedValue({ examined: 3, deleted: 3, failed: 0 });
    });
    afterEach(() => vi.unstubAllEnvs());

    it('accepts only the cron secret, never the monitor token, a missing secret or a POST', async () => {
        await request(app).get('/api/operations/upload-reconcile').expect(401);
        await request(app).get('/api/operations/upload-reconcile').set('Authorization', `Bearer ${'x'.repeat(64)}`).expect(401);
        // POST falls through to the session-authenticated routes.
        await request(app).post('/api/operations/upload-reconcile').set('Authorization', `Bearer ${secret}`).expect(401);
        vi.stubEnv('CRON_SECRET', '');
        await request(app).get('/api/operations/upload-reconcile').set('Authorization', 'Bearer ').expect(401);
        expect(io.cleanup).not.toHaveBeenCalled();
    });

    it('removes a bounded batch of expired direct uploads and reports counts only, without caching', async () => {
        const response = await cron().expect(200);
        expect(response.body).toEqual({ status: 'reconciled', examined: 3, deleted: 3, failed: 0 });
        expect(response.headers['cache-control']).toBe('no-store');
        expect(io.cleanup).toHaveBeenCalledWith(100);
    });

    it('marks the run incomplete while a deletion waits for its retry', async () => {
        io.cleanup.mockResolvedValue({ examined: 2, deleted: 1, failed: 1 });
        expect((await cron().expect(503)).body).toEqual({ status: 'incomplete', examined: 2, deleted: 1, failed: 1 });
    });

    it('does nothing where private object storage is not in use', async () => {
        io.storage.mockReturnValue({ provider: 'disabled', ready: false });
        expect((await cron().expect(200)).body).toEqual({ status: 'not_supported' });
        expect(io.cleanup).not.toHaveBeenCalled();
    });

    it('hides a database or storage failure behind a fixed status', async () => {
        io.cleanup.mockRejectedValue(new Error('private connection string'));
        const response = await cron().expect(503);
        expect(response.body).toEqual({ status: 'failed' });
    });
});
