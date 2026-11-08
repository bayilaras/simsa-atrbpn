import express from 'express';
import request from 'supertest';
import type { MemoryStore } from 'express-rate-limit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ids = vi.hoisted(() => ({
    admin: '11111111-1111-4111-8111-111111111111',
    target: '22222222-2222-4222-8222-222222222222',
}));

vi.mock('../config/database', () => ({ db: {} }));
// A MemoryStore per bucket makes the counted requests observable without the
// shared PostgreSQL store.
const stores = vi.hoisted(() => new Map<string, MemoryStore>());
vi.mock('../config/rate-limits.js', async () => {
    const { MemoryStore } = await import('express-rate-limit');
    return {
        usesSharedRateLimits: () => false,
        createRateLimiterStore: (bucket: string) => {
            const store = new MemoryStore();
            stores.set(bucket, store);
            return store;
        },
    };
});
// The session cookie names the signed-in account, so the limiter keys each
// request to that user as it does in production.
vi.mock('../services/request-identity.service.js', () => ({
    verifyRequestIdentity: async (req: { headers: { cookie?: string } }) => {
        const subject = /better-auth\.session_token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
        return subject ? { subject, role: 'super_admin', unitKerjaId: null, isActive: true } : null;
    },
}));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: ids.admin, email: 'admin@example.go.id', name: 'Admin', role: 'super_admin', unitKerjaId: null };
        next();
    },
}));
vi.mock('../services/user-management.service', () => ({
    SELF_PASSWORD_RESET_MESSAGE: 'Gunakan menu ubah kata sandi untuk akun sendiri.',
    default: {
        listUsers: vi.fn().mockResolvedValue({ data: [], pagination: { total: 0 } }),
        getRoles: vi.fn().mockReturnValue([]),
        listUnitKerja: vi.fn().mockResolvedValue([]),
        getUserById: vi.fn().mockResolvedValue({ id: ids.target }),
        createUser: vi.fn().mockResolvedValue({ id: ids.target }),
        updateUser: vi.fn().mockResolvedValue({ id: ids.target }),
        resetPassword: vi.fn().mockResolvedValue({ id: ids.target }),
        deactivateUser: vi.fn().mockResolvedValue({ id: ids.target, isActive: false }),
    },
}));

import userManagementRouter from '../routes/user-management.routes';
import userManagementService from '../services/user-management.service';

const SENSITIVE_MAX = 20;
const TARGET = `/api/users/${ids.target}`;
const NEW_USER = { email: 'baru@example.go.id', name: 'Pengguna Baru', role: 'admin_unit', unitKerjaId: 'ditjen' };

const app = express();
app.use(express.json());
app.use('/api/users', userManagementRouter);

const asAdmin = (call: request.Test) => call.set('Cookie', `better-auth.session_token=${ids.admin}`);
const sensitiveHits = async () => (await stores.get('sensitive')!.get(`user:${ids.admin}`))?.totalHits ?? 0;

const changes = [
    () => request(app).post('/api/users').send(NEW_USER),
    () => request(app).put(TARGET).send({ role: 'admin_unit', unitKerjaId: 'ditjen' }),
    () => request(app).post(`${TARGET}/password`).send({ newPassword: 'Sandi-Baru-2026' }),
    () => request(app).delete(TARGET),
];

describe('user management rate limits', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await stores.get('sensitive')!.resetAll();
    });

    it('does not count user list reads against the sensitive quota', async () => {
        const reads = ['/api/users?search=budi', '/api/users/roles', '/api/users/unit-kerja', TARGET];
        // Page visits and filter changes add up to more than the sensitive maximum.
        for (let i = 0; i < SENSITIVE_MAX + 5; i += 1) {
            const response = await asAdmin(request(app).get(reads[i % reads.length])).expect(200);
            expect(response.headers['ratelimit-limit']).toBeUndefined();
        }
        await asAdmin(request(app).head('/api/users')).expect(200);
        expect(await sensitiveHits()).toBe(0);

        const created = await asAdmin(changes[0]()).expect(201);
        expect(created.headers['ratelimit-remaining']).toBe(String(SENSITIVE_MAX - 1));
    });

    it('limits user changes to the sensitive quota while reads stay available', async () => {
        for (let i = 0; i < SENSITIVE_MAX; i += 1) {
            const response = await asAdmin(changes[i % changes.length]());
            expect(response.status).toBeLessThan(300);
        }
        expect(await sensitiveHits()).toBe(SENSITIVE_MAX);

        for (const change of changes) {
            const limited = await asAdmin(change()).expect(429);
            expect(limited.body.message).toBe('Terlalu banyak operasi sensitif. Coba lagi setelah 15 menit.');
        }
        await asAdmin(request(app).patch(TARGET).send({})).expect(429);
        expect(userManagementService.createUser).toHaveBeenCalledTimes(SENSITIVE_MAX / changes.length);
        expect(userManagementService.deactivateUser).toHaveBeenCalledTimes(SENSITIVE_MAX / changes.length);

        await asAdmin(request(app).get('/api/users')).expect(200);
        await asAdmin(request(app).get(TARGET)).expect(200);
    });
});
