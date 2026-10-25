import express from 'express';
import request from 'supertest';
import { afterEach, describe, it, expect, vi } from 'vitest';
import router from '../routes/operations.routes.js';

const state = vi.hoisted(() => ({ role: null as string | null }));
const status = vi.hoisted(() => vi.fn(async () => ({ status: 'attention', checks: [], timestamp: '2026-09-15T00:00:00Z' })));
vi.mock('../services/operations-status.service.js', () => ({ getOperationsStatus: status }));
vi.mock('../middlewares/auth.middleware.js', () => ({ authMiddleware: (req: any, res: any, next: any) => {
    if (!state.role) return res.status(401).json({ error: 'Unauthorized' });
    req.user = { id: 'test-user', role: state.role };
    next();
} }));
vi.mock('../config/database.js', () => ({ pool: { totalCount: 3, idleCount: 1, waitingCount: 2 } }));
const app = express();
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
