import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    suratMasuk: { findById: vi.fn(), findByIdWithLinks: vi.fn(), getBalasan: vi.fn() },
    suratKeluar: { findById: vi.fn(), findByIdWithLinks: vi.fn(), getSourceSuratMasuk: vi.fn() },
    recordAccess: { check: vi.fn() },
}));

vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-1', email: 'admin@example.test', role: 'admin_unit', unitKerjaId: 'ditjen' };
        next();
    },
}));
vi.mock('../middlewares/role.middleware', () => ({
    canWriteMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: mocks.suratMasuk }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: mocks.suratKeluar }));
vi.mock('../services/record-access.service', () => ({
    allowedSecurityClassifications: () => ['biasa', 'terbatas'],
    isAllowedForClassification: () => true,
    recordAccessService: mocks.recordAccess,
}));
vi.mock('../services/audit-log.service', () => ({
    default: { logAction: vi.fn(), logActionOrThrow: vi.fn() },
}));

// validate.middleware TIDAK di-mock.
const { default: suratMasukRouter } = await import('../routes/surat-masuk.routes');
const { default: suratKeluarRouter } = await import('../routes/surat-keluar.routes');

const app = express();
app.use(express.json());
app.use('/api/surat-masuk', suratMasukRouter);
app.use('/api/surat-keluar', suratKeluarRouter);

const ROUTES: Array<[method: 'get' | 'post', template: string]> = [
    ['get', '/api/surat-masuk/:id/balasan'],
    ['get', '/api/surat-masuk/:id/with-links'],
    ['post', '/api/surat-masuk/:id/archive-full'],
    ['get', '/api/surat-keluar/:id/source'],
    ['get', '/api/surat-keluar/:id/with-links'],
    ['post', '/api/surat-keluar/:id/archive-full'],
];

const INVALID_IDS = [
    'not-a-uuid',
    '123',
    "1' OR '1'='1",
    '550e8400-e29b-41d4-a716-44665544000',
    '550e8400-e29b-41d4-a716-4466554400000',
    '550e8400e29b41d4a716446655440000',
    '550e8400-e29b-41d4-a716-446655440000 ',
    'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
];

const CASES = ROUTES.flatMap(([method, template]) =>
    INVALID_IDS.map(id => [method, template, id] as const));

const allServiceMocks = () => [
    ...Object.values(mocks.suratMasuk),
    ...Object.values(mocks.suratKeluar),
    mocks.recordAccess.check,
];

describe('validasi :id pada route turunan surat', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.suratMasuk.findById.mockResolvedValue(null);
        mocks.suratMasuk.findByIdWithLinks.mockResolvedValue(null);
        mocks.suratKeluar.findById.mockResolvedValue(null);
        mocks.suratKeluar.findByIdWithLinks.mockResolvedValue(null);
    });

    it.each(CASES)('%s %s dengan id %j → 400 tanpa menyentuh service', async (method, template, id) => {
        const res = await request(app)[method](template.replace(':id', encodeURIComponent(id))).send({});
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ success: false, error: 'Invalid ID format' });
        for (const mock of allServiceMocks()) expect(mock).not.toHaveBeenCalled();
    });

    it.each(ROUTES)('%s %s dengan UUID valid (termasuk huruf besar) diteruskan ke handler', async (method, template) => {
        for (const id of ['550e8400-e29b-41d4-a716-446655440000', '550E8400-E29B-41D4-A716-446655440000']) {
            const res = await request(app)[method](template.replace(':id', id)).send({});
            expect(res.status).toBe(404);
        }
    });

    it('POST /:id/archive tetap 410 dan tidak berubah', async () => {
        await request(app).post('/api/surat-masuk/not-a-uuid/archive').send({}).expect(410);
        await request(app).post('/api/surat-keluar/not-a-uuid/archive').send({}).expect(410);
    });
});
