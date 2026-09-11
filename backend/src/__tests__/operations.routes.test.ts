import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import router from '../routes/operations.routes.js';

const state = vi.hoisted(() => ({ role: null as string | null }));
vi.mock('../middlewares/auth.middleware.js', () => ({ authMiddleware: (req: any, res: any, next: any) => {
    if (!state.role) return res.status(401).json({ error: 'Unauthorized' });
    req.user = { id: 'test-user', role: state.role };
    next();
} }));
vi.mock('../config/database.js', () => ({ pool: { totalCount: 3, idleCount: 1, waitingCount: 2 } }));
const app = express();
app.use('/api/operations', router);

describe('operations metrics access', () => {
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
