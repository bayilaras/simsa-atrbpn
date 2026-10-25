import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { AppError } from '../../utils/errors.js';
import { publicErrorResponse, publicErrorStatus } from '../../utils/public-error.js';

const state = vi.hoisted(() => ({
    env: { FRONTEND_URL: 'https://simsa-frontend.example.test', NODE_ENV: 'production', VERCEL_ENV: 'production' },
    user: { id: 'actor', role: 'admin_unit', unitKerjaId: 'sesditjen' } as any,
    location: vi.fn(), archive: vi.fn(),
}));
vi.mock('../../config/env.js', () => ({ env: state.env }));
vi.mock('../../config/database', () => ({ db: {} }));
vi.mock('../../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => { req.user = state.user; next(); },
}));
vi.mock('../../middlewares/role.middleware', () => ({ canWriteMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../../middlewares/rate-limiter.middleware', () => ({ sensitiveLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../../services/archive-lending.service', () => ({ archiveLendingService: {} }));
vi.mock('../../services/storage-location.service', () => ({
    storageLocationService: { generateQRCode: state.location, generateArsipQRCode: state.archive },
}));
import archiveRouter from '../archive-lending.routes';
import locationRouter from '../storage-location.routes';

const app = express();
app.set('trust proxy', true); // Exercise a deployment with forwarded protocol/host.
app.use('/api/archive-lending', archiveRouter);
app.use('/api/storage-locations', locationRouter);
app.use((error: unknown, _req: any, res: any, _next: any) => {
    res.status(publicErrorStatus(error)).json(publicErrorResponse(error));
});
const id = '550e8400-e29b-41d4-a716-446655440020';
const endpoints = [
    { name: 'location', route: `/api/storage-locations/${id}/qr`, call: () => state.location },
    { name: 'archive', route: `/api/archive-lending/qr/arsip/${id}`, call: () => state.archive },
];

describe.each(endpoints)('$name QR public destination', ({ route, call }) => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.env.FRONTEND_URL = 'https://simsa-frontend.example.test';
        state.env.NODE_ENV = 'production';
        state.env.VERCEL_ENV = 'production';
        state.user = { id: 'actor', role: 'admin_unit', unitKerjaId: 'sesditjen' };
        state.location.mockImplementation(async (_id, origin) => ({ qrUrl: `${origin}/storage-locations/${id}`, qrDataUrl: 'data:image/png;base64,test' }));
        state.archive.mockImplementation(async (_id, origin) => ({ qrUrl: `${origin}/arsip/detail/${id}`, arsip: { klasifikasiKeamanan: 'biasa' } }));
    });

    it('uses the configured frontend when the deployment host differs', async () => {
        const response = await request(app).get(route).set('Host', 'simsa-backend-immutable.vercel.app');
        expect(response.status).toBe(200);
        expect(new URL(response.body.data.qrUrl).origin).toBe(state.env.FRONTEND_URL);
        expect(call()).toHaveBeenCalledWith(id, state.env.FRONTEND_URL, 'sesditjen');
    });

    it('ignores spoofed Host, Origin and proxy headers', async () => {
        const response = await request(app).get(route).set({ Host: 'attacker.example.test', Origin: 'https://origin-attacker.example.test',
            'X-Forwarded-Host': 'forwarded-attacker.example.test', 'X-Forwarded-Proto': 'http' });
        expect(response.status).toBe(200);
        expect(new URL(response.body.data.qrUrl).origin).toBe(state.env.FRONTEND_URL);
    });

    it('normalizes the configured trailing slash', async () => {
        state.env.FRONTEND_URL += '/';
        expect((await request(app).get(route)).status).toBe(200);
        expect(call()).toHaveBeenCalledWith(id, 'https://simsa-frontend.example.test', 'sesditjen');
    });

    it('preserves explicitly configured HTTP for local development', async () => {
        state.env.FRONTEND_URL = 'http://localhost:3000/';
        state.env.NODE_ENV = 'development';
        state.env.VERCEL_ENV = '';
        expect((await request(app).get(route)).status).toBe(200);
        expect(call()).toHaveBeenCalledWith(id, 'http://localhost:3000', 'sesditjen');
    });

    it.each(['', 'invalid', 'javascript:alert(1)', 'https://user:secret@example.test',
        'https://frontend.example.test/path', 'https://frontend.example.test/?secret=x',
        'https://frontend.example.test/#fragment', 'http://frontend.example.test'])('fails closed for invalid deployed configuration %s', async value => {
        state.env.FRONTEND_URL = value;
        const response = await request(app).get(route).set('Host', 'fallback-attacker.example.test');
        expect(response.status).toBe(500);
        expect(response.body.code).toBe('INTERNAL_ERROR');
        expect(JSON.stringify(response.body)).not.toMatch(/secret|fallback-attacker/);
        expect(call()).not.toHaveBeenCalled();
    });

    it('keeps assigned-unit authorization despite a forged query unit', async () => {
        expect((await request(app).get(route + '?unitKerjaId=ditjen')).status).toBe(200);
        expect(call()).toHaveBeenCalledWith(id, expect.any(String), 'sesditjen');
    });

    it('requires an explicit unit for super_admin', async () => {
        state.user = { id: 'actor', role: 'super_admin', unitKerjaId: null };
        expect((await request(app).get(route)).status).toBe(400);
        expect(call()).not.toHaveBeenCalled();
        expect((await request(app).get(route + '?unitKerjaId=ditjen')).status).toBe(200);
        expect(call()).toHaveBeenCalledWith(id, expect.any(String), 'ditjen');
    });

    it('keeps an inaccessible record as 404 without returning a QR', async () => {
        call().mockRejectedValue(new AppError('Record not found', 404));
        const response = await request(app).get(route);
        expect(response.status).toBe(404);
        expect(response.body.data).toBeUndefined();
    });
});

it('keeps archive classification restrictions after generating its destination', async () => {
    state.env.FRONTEND_URL = 'https://simsa-frontend.example.test';
    state.user = { id: 'actor', role: 'admin_unit', unitKerjaId: 'sesditjen' };
    state.archive.mockResolvedValue({ qrUrl: 'https://simsa-frontend.example.test/arsip/detail/' + id,
        arsip: { klasifikasiKeamanan: 'rahasia' } });
    const response = await request(app).get(`/api/archive-lending/qr/arsip/${id}`);
    expect(response.status).toBe(404);
    expect(response.body.data).toBeUndefined();
});
