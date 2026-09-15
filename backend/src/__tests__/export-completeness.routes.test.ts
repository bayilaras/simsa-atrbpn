import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ findAll: vi.fn() }));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: { findAll: state.findAll } }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: { findAll: state.findAll } }));
vi.mock('../services/arsip.service', () => ({ arsipService: { findAll: state.findAll } }));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'staff-a', role: 'staff', unitKerjaId: 'unit-a' }; next();
} }));
vi.mock('../middlewares/role.middleware', () => ({ permissionMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../middlewares/rate-limiter.middleware', () => ({ exportLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/record-access.service.js', () => ({ allowedSecurityClassifications: () => ['biasa'] }));
vi.mock('../utils/logger', () => ({ createLogger: () => ({ error: vi.fn() }) }));
const { exportRoutes } = await import('../routes/export.routes');
const app = express().use('/api/export', exportRoutes);

describe('export count and data share authorized filters', () => {
    beforeEach(() => vi.clearAllMocks());
    it.each(['surat-masuk', 'surat-keluar', 'arsip'])('preserves search and denies count widening for %s', async type => {
        state.findAll.mockImplementation(async filters => {
            const correctlyScoped = filters.unitKerjaId === 'unit-a'
                && filters.search === 'tanah'
                && filters.securityClassifications.join() === 'biasa';
            return { data: [], pagination: { total: correctlyScoped ? 0 : 20000 } };
        });
        await request(app).get(`/api/export/${type}/excel?unitKerjaId=unit-b&search=tanah&securityClassifications=rahasia`).expect(200);
        expect(state.findAll).toHaveBeenCalledWith(expect.objectContaining({
            unitKerjaId: 'unit-a', search: 'tanah', securityClassifications: ['biasa'], limit: 10000,
        }));
    });
    it.each(['surat-masuk', 'surat-keluar', 'arsip'])('returns an actionable 422 for an oversized %s PDF', async type => {
        state.findAll.mockResolvedValue({ data: [], pagination: { total: 10001 } });
        const response = await request(app).get(`/api/export/${type}/pdf`).expect(422);
        expect(response.body).toMatchObject({ error: 'EXPORT_LIMIT_EXCEEDED', total: 10001, limit: 10000 });
        expect(response.body.message).toContain('Persempit filter');
        expect(response.headers['content-disposition']).toBeUndefined();
    });
});
