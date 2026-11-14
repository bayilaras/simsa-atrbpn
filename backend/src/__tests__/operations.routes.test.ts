import express from 'express';
import request from 'supertest';
import { afterEach, describe, it, expect, vi } from 'vitest';
import router from '../routes/operations.routes.js';

const state = vi.hoisted(() => ({ role: null as string | null }));
const status = vi.hoisted(() => vi.fn(async () => ({ status: 'attention', checks: [], timestamp: '2026-09-15T00:00:00Z' })));
const invalidate = vi.hoisted(() => vi.fn());
vi.mock('../services/operations-status.service.js', () => ({ getOperationsStatus: status, invalidateOperationsStatus: invalidate }));
const scans = vi.hoisted(() => ({ list: vi.fn(), requeue: vi.fn(), wake: vi.fn(), limited: vi.fn(), audit: vi.fn() }));
vi.mock('../services/malware-scan-requeue.service.js', () => ({ listFailedScans: scans.list, requeueFailedScans: scans.requeue, recordScannerRun: scans.audit }));
vi.mock('../services/malware-scan-dispatch.service.js', () => ({ scheduleMalwareScanWake: scans.wake }));
vi.mock('../middlewares/rate-limiter.middleware.js', () => ({ sensitiveLimiter: (_req: any, _res: any, next: any) => { scans.limited(); next(); } }));
vi.mock('../middlewares/auth.middleware.js', () => ({ authMiddleware: (req: any, res: any, next: any) => {
    if (!state.role) return res.status(401).json({ error: 'Unauthorized' });
    req.user = { id: 'test-user', email: 'admin@example.test', role: state.role };
    next();
} }));
vi.mock('../config/database.js', () => ({ pool: { totalCount: 3, idleCount: 1, waitingCount: 2 } }));
const app = express();
app.use(express.json());
app.use('/api/operations', router);

describe('operations metrics access', () => {
    afterEach(() => { vi.unstubAllEnvs(); status.mockClear(); });
    it.each([null, 'user', 'admin_unit', 'admin_dirjen', 'admin_sesditjen', 'auditor'])('protects operational status from role %s', async role => {
        state.role = role;
        await request(app).get('/api/operations/status').expect(role ? 403 : 401);
        expect(status).not.toHaveBeenCalled();
    });
    it('returns operational status to Super Admin without caching', async () => {
        state.role = 'super_admin';
        const response = await request(app).get('/api/operations/status').expect(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.body.data.status).toBe('attention');
    });
    it('requires a configured dedicated token for the CI probe and never queries on rejection', async () => {
        state.role = null;
        vi.stubEnv('OPERATIONS_MONITOR_TOKEN', '');
        await request(app).get('/api/operations/probe').expect(401);
        vi.stubEnv('OPERATIONS_MONITOR_TOKEN', 'x'.repeat(64));
        await request(app).get('/api/operations/probe').set('Authorization', 'Bearer wrong').expect(401);
        expect(status).not.toHaveBeenCalled();
    });
    it('makes CI fail when a check needs attention and exposes only bounded check states', async () => {
        vi.stubEnv('OPERATIONS_MONITOR_TOKEN', 'x'.repeat(64));
        const response = await request(app).get('/api/operations/probe').set('Authorization', `Bearer ${'x'.repeat(64)}`).expect(503);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.body.status).toBe('attention');
        expect(response.body).not.toHaveProperty('data');
    });
    it('rejects a same-character-length non-ASCII token without throwing or collecting status', async () => {
        vi.stubEnv('OPERATIONS_MONITOR_TOKEN', 'x'.repeat(64));
        await request(app).get('/api/operations/probe').set('Authorization', `Bearer ${'é'.repeat(64)}`).expect(401);
        expect(status).not.toHaveBeenCalled();
    });
    it.each([null, 'staff', 'admin_dirjen', 'admin_sesditjen', 'auditor'])('rejects role %s before exposing metrics', async role => {
        state.role = role;
        const response = await request(app).get('/api/operations/metrics').expect(role ? 403 : 401);
        expect(response.body).not.toHaveProperty('data');
    });
    it('returns bounded process statistics to a super administrator without caching', async () => {
        state.role = 'super_admin';
        const response = await request(app).get('/api/operations/metrics').expect(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.body.data).toMatchObject({
            scope: 'current_process_since_start', databasePool: { total: 3, idle: 1, waiting: 2 },
        });
        expect(response.body.data.memoryBytes.rss).toBeGreaterThan(0);
        expect(JSON.stringify(response.body)).not.toContain('test-user');
    });
});

describe('requeueing failed document scans', () => {
    const fileId = '00000000-0000-4000-8000-000000000001';
    afterEach(() => { Object.values(scans).forEach(mock => mock.mockReset()); invalidate.mockReset(); });
    it.each([null, 'user', 'staff', 'admin_unit', 'admin_dirjen', 'admin_sesditjen', 'auditor'])('keeps the list and both actions from role %s', async role => {
        state.role = role;
        const denied = role ? 403 : 401;
        await request(app).get('/api/operations/scan-failures').expect(denied);
        await request(app).post('/api/operations/scan-failures/requeue').send({}).expect(denied);
        await request(app).post(`/api/operations/scan-failures/${fileId}/requeue`).send({}).expect(denied);
        expect(scans.list).not.toHaveBeenCalled();
        expect(scans.requeue).not.toHaveBeenCalled();
    });
    it('lists failed scans for Super Admin without caching', async () => {
        state.role = 'super_admin';
        scans.list.mockResolvedValue({ total: 1, files: [{ id: fileId, fileName: 'surat.pdf', entityType: 'surat_masuk', uploadedAt: '2026-09-15T00:00:00.000Z', contentMismatch: false }] });
        const response = await request(app).get('/api/operations/scan-failures').expect(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.body.data).toMatchObject({ total: 1, files: [{ id: fileId, fileName: 'surat.pdf' }] });
    });
    it('requeues a bounded batch, records who asked, refreshes the status and wakes the scanner', async () => {
        state.role = 'super_admin';
        scans.requeue.mockResolvedValue({ requeued: 3, remaining: 0 });
        scans.wake.mockReturnValue(true);
        const response = await request(app).post('/api/operations/scan-failures/requeue').send({}).expect(200);
        expect(response.body).toEqual({ success: true, data: { requeued: 3, remaining: 0, wakeScheduled: true } });
        expect(scans.requeue).toHaveBeenCalledWith({ attachmentId: undefined }, expect.objectContaining({ userId: 'test-user', userEmail: 'admin@example.test' }));
        expect(scans.limited).toHaveBeenCalledOnce();
        expect(invalidate).toHaveBeenCalledOnce();
    });
    it('requeues one file and still succeeds when the scanner cannot be woken', async () => {
        state.role = 'super_admin';
        scans.requeue.mockResolvedValue({ requeued: 1, remaining: 4 });
        scans.wake.mockImplementation(() => { throw new Error('private wake detail'); });
        const response = await request(app).post(`/api/operations/scan-failures/${fileId}/requeue`).send({}).expect(200);
        expect(response.body.data).toEqual({ requeued: 1, remaining: 4, wakeScheduled: false });
        expect(scans.requeue).toHaveBeenCalledWith({ attachmentId: fileId }, expect.anything());
    });
    it('answers 409 when the chosen file is no longer a failed scan and does not wake the scanner', async () => {
        state.role = 'super_admin';
        scans.requeue.mockResolvedValue({ requeued: 0, remaining: 0 });
        const response = await request(app).post(`/api/operations/scan-failures/${fileId}/requeue`).send({}).expect(409);
        expect(response.body.message).toMatch(/tidak sedang berstatus gagal dipindai/);
        expect(scans.wake).not.toHaveBeenCalled();
    });
    it('does not wake the scanner when a batch found nothing to requeue', async () => {
        state.role = 'super_admin';
        scans.requeue.mockResolvedValue({ requeued: 0, remaining: 0 });
        await request(app).post('/api/operations/scan-failures/requeue').send({}).expect(200);
        expect(scans.wake).not.toHaveBeenCalled();
    });
    it.each([
        ['/api/operations/scan-failures/not-an-id/requeue', {}],
        ['/api/operations/scan-failures/requeue?status=infected', {}],
        ['/api/operations/scan-failures/requeue', { status: 'infected' }],
    ])('rejects a malformed request %s before touching the queue', async (path, body) => {
        state.role = 'super_admin';
        await request(app).post(path).send(body).expect(400);
        expect(scans.requeue).not.toHaveBeenCalled();
    });
    it('hides database failures behind a plain Indonesian message', async () => {
        state.role = 'super_admin';
        scans.requeue.mockRejectedValue(new Error('private connection string'));
        scans.list.mockRejectedValue(new Error('private connection string'));
        const failed = await request(app).post('/api/operations/scan-failures/requeue').send({}).expect(503);
        expect(failed.body.message).toBe('Berkas belum dapat diantre ulang. Coba lagi beberapa saat lagi.');
        const list = await request(app).get('/api/operations/scan-failures').expect(503);
        expect(JSON.stringify([failed.body, list.body])).not.toContain('private');
    });
});

describe('running the scanner from monitoring', () => {
    afterEach(() => { Object.values(scans).forEach(mock => mock.mockReset()); });
    it.each([null, 'user', 'staff', 'admin_unit', 'admin_dirjen', 'admin_sesditjen', 'auditor'])('keeps the action from role %s', async role => {
        state.role = role;
        await request(app).post('/api/operations/scanner-run').send({}).expect(role ? 403 : 401);
        expect(scans.audit).not.toHaveBeenCalled();
        expect(scans.wake).not.toHaveBeenCalled();
    });
    it('records who asked before waking the scanner, rate limited and without caching', async () => {
        state.role = 'super_admin';
        const order: string[] = [];
        scans.audit.mockImplementation(async () => { order.push('audit'); });
        scans.wake.mockImplementation(() => { order.push('wake'); return true; });
        const response = await request(app).post('/api/operations/scanner-run').send({}).expect(200);
        expect(response.body).toEqual({ success: true, data: { wakeScheduled: true } });
        expect(response.headers['cache-control']).toBe('no-store');
        expect(scans.audit).toHaveBeenCalledWith(expect.objectContaining({ userId: 'test-user', userEmail: 'admin@example.test' }));
        expect(order).toEqual(['audit', 'wake']);
        expect(scans.limited).toHaveBeenCalledOnce();
    });
    it('does not wake the scanner when the audit record cannot be written', async () => {
        state.role = 'super_admin';
        scans.audit.mockRejectedValue(new Error('private connection string'));
        const response = await request(app).post('/api/operations/scanner-run').send({}).expect(503);
        expect(response.body.message).toBe('Pemindai belum dapat dijalankan. Coba lagi beberapa saat lagi.');
        expect(JSON.stringify(response.body)).not.toContain('private');
        expect(scans.wake).not.toHaveBeenCalled();
    });
    it.each([['returns false', () => false], ['throws', () => { throw new Error('private wake detail'); }]])(
        'says plainly that the scanner cannot be run when the wake %s', async (_label, wake) => {
            state.role = 'super_admin';
            scans.audit.mockResolvedValue(undefined);
            scans.wake.mockImplementation(wake);
            const response = await request(app).post('/api/operations/scanner-run').send({}).expect(503);
            expect(response.body).toEqual({ success: false, message: 'Pemindai tidak dapat dijalankan dari layanan ini. Periksa pengaturan pemindai pada layanan backend.' });
        });
    it.each([['/api/operations/scanner-run?force=1', {}], ['/api/operations/scanner-run', { files: ['x'] }]])(
        'rejects a malformed request %s before auditing or waking', async (path, body) => {
            state.role = 'super_admin';
            await request(app).post(path).send(body).expect(400);
            expect(scans.audit).not.toHaveBeenCalled();
            expect(scans.wake).not.toHaveBeenCalled();
        });
});
