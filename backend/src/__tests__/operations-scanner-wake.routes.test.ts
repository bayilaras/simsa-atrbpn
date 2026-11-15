import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import router from '../routes/operations.routes.js';

const io = vi.hoisted(() => ({ readiness: vi.fn(), wake: vi.fn(), status: vi.fn(), waiting: vi.fn() }));
vi.mock('../services/readiness.service.js', () => ({ getReadiness: io.readiness }));
vi.mock('../services/malware-scan-dispatch.service.js', () => ({ scheduleMalwareScanWake: io.wake }));
vi.mock('../services/operations-status.service.js', () => ({ getOperationsStatus: io.status }));
vi.mock('../services/malware-scan-requeue.service.js', () => ({ hasWaitingScanWork: io.waiting }));
vi.mock('../config/database.js', () => ({ pool: { totalCount: 0, idleCount: 0, waitingCount: 0 } }));

const token = 'x'.repeat(64);
const now = Date.parse('2026-10-04T12:00:00Z');
const worker = (malwareWorker: unknown) => ({ dependencies: { malwareWorker } });
const app = express();
app.use('/api/operations', router);
const wake = () => request(app).post('/api/operations/scanner-wake').set('Authorization', `Bearer ${token}`);

describe('POST /api/operations/scanner-wake', () => {
    beforeEach(() => {
        vi.useFakeTimers({ now, toFake: ['Date'] });
        vi.stubEnv('OPERATIONS_MONITOR_TOKEN', token);
        io.wake.mockReset().mockReturnValue(true);
        io.readiness.mockReset();
        io.waiting.mockReset().mockResolvedValue(false);
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
    const fresh = () => worker({ state: 'ready', definitionsExpiresAt: new Date(now + 14 * 3600_000).toISOString() });

    it('requires the dedicated monitor token before reading readiness or waking', async () => {
        await request(app).post('/api/operations/scanner-wake').expect(401);
        await request(app).post('/api/operations/scanner-wake').set('Authorization', 'Bearer wrong').expect(401);
        vi.stubEnv('OPERATIONS_MONITOR_TOKEN', '');
        await request(app).post('/api/operations/scanner-wake').set('Authorization', 'Bearer ').expect(401);
        expect(io.readiness).not.toHaveBeenCalled();
        expect(io.waiting).not.toHaveBeenCalled();
        expect(io.wake).not.toHaveBeenCalled();
    });

    it('does not wake a scanner whose verification remains valid for more than thirteen hours and has no waiting file', async () => {
        io.readiness.mockResolvedValue(fresh());
        const response = await wake().expect(200);
        expect(response.body).toEqual({ status: 'fresh' });
        expect(response.headers['cache-control']).toBe('no-store');
        expect(io.waiting).toHaveBeenCalledOnce();
        expect(io.wake).not.toHaveBeenCalled();
    });

    it('wakes a scanner with fresh definitions when a file has waited too long for its scan', async () => {
        io.readiness.mockResolvedValue(fresh());
        io.waiting.mockResolvedValue(true);
        expect((await wake().expect(202)).body).toEqual({ status: 'scheduled' });
        expect(io.wake).toHaveBeenCalledOnce();
    });

    it('treats an unreadable scan queue as waiting work and never reports it as fresh', async () => {
        io.readiness.mockResolvedValue(fresh());
        io.waiting.mockRejectedValue(new Error('private database detail'));
        const response = await wake().expect(202);
        expect(JSON.stringify(response.body)).not.toContain('private');
        expect(io.wake).toHaveBeenCalledOnce();
    });

    it.each([
        ['expiring within thirteen hours', { state: 'ready', definitionsExpiresAt: new Date(now + 12 * 3600_000).toISOString() }],
        ['expired or missing', { state: 'not_ready', reason: 'on_demand_verification_missing_or_expired' }],
        ['in standby after its lease lapsed', { state: 'standby', reason: 'definitions_lease_expired' }],
        ['in standby on a newly promoted deployment', { state: 'standby', reason: 'awaiting_first_run_on_deployment' }],
        ['malformed expiry', { state: 'ready', definitionsExpiresAt: 'tomorrow' }],
    ])('schedules a wake when verification is %s', async (_label, malwareWorker) => {
        io.readiness.mockResolvedValue(worker(malwareWorker));
        expect((await wake().expect(202)).body).toEqual({ status: 'scheduled' });
        expect(io.wake).toHaveBeenCalledOnce();
        // Waking already: the queue is not read again.
        expect(io.waiting).not.toHaveBeenCalled();
    });

    it('reports when the production wake path is unavailable without exposing details', async () => {
        io.readiness.mockResolvedValue(worker({ state: 'not_ready' }));
        io.wake.mockReturnValue(false);
        expect((await wake().expect(503)).body).toEqual({ status: 'unavailable' });
    });

    it('does nothing where malware scanning is not required', async () => {
        io.readiness.mockResolvedValue(worker({ state: 'disabled', required: false }));
        expect((await wake().expect(200)).body).toEqual({ status: 'not_required' });
        expect(io.wake).not.toHaveBeenCalled();
    });

    it('treats a readiness failure as a reason to wake, never as healthy', async () => {
        io.readiness.mockRejectedValue(new Error('private database detail'));
        const response = await wake().expect(202);
        expect(JSON.stringify(response.body)).not.toContain('private');
        expect(io.wake).toHaveBeenCalledOnce();
    });
});

describe('GET /api/operations/scanner-wake (Vercel Cron)', () => {
    beforeEach(() => {
        vi.stubEnv('CRON_SECRET', 'c'.repeat(48));
        vi.stubEnv('OPERATIONS_MONITOR_TOKEN', token);
        io.wake.mockReset().mockReturnValue(true);
        io.readiness.mockReset().mockResolvedValue(worker({ state: 'not_ready' }));
        io.waiting.mockReset().mockResolvedValue(false);
    });
    afterEach(() => vi.unstubAllEnvs());

    it('accepts only the cron secret, never the monitor token or a missing secret', async () => {
        await request(app).get('/api/operations/scanner-wake').expect(401);
        await request(app).get('/api/operations/scanner-wake').set('Authorization', `Bearer ${token}`).expect(401);
        vi.stubEnv('CRON_SECRET', '');
        await request(app).get('/api/operations/scanner-wake').set('Authorization', 'Bearer ').expect(401);
        expect(io.readiness).not.toHaveBeenCalled();
        expect(io.wake).not.toHaveBeenCalled();
    });

    it('wakes an expired scanner with the cron secret without caching the response', async () => {
        const response = await request(app).get('/api/operations/scanner-wake').set('Authorization', `Bearer ${'c'.repeat(48)}`).expect(202);
        expect(response.body).toEqual({ status: 'scheduled' });
        expect(response.headers['cache-control']).toBe('no-store');
        expect(io.wake).toHaveBeenCalledOnce();
    });

    it('wakes a fresh scanner from the cron when files are waiting, and answers fresh otherwise', async () => {
        io.readiness.mockResolvedValue(worker({ state: 'ready', definitionsExpiresAt: new Date(Date.now() + 20 * 3600_000).toISOString() }));
        const cron = () => request(app).get('/api/operations/scanner-wake').set('Authorization', `Bearer ${'c'.repeat(48)}`);
        expect((await cron().expect(200)).body).toEqual({ status: 'fresh' });
        expect(io.wake).not.toHaveBeenCalled();
        io.waiting.mockResolvedValue(true);
        expect((await cron().expect(202)).body).toEqual({ status: 'scheduled' });
        expect(io.wake).toHaveBeenCalledOnce();
    });
});
