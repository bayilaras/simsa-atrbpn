import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    distribution: { distribute: vi.fn() },
    recordAccess: { check: vi.fn() },
}));

vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-1', email: 'tu@example.test', name: 'Petugas TU', role: 'admin_unit', unitKerjaId: 'ditjen' };
        next();
    },
}));
vi.mock('../middlewares/role.middleware.js', () => ({
    canWriteMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../services/distribution.service.js', () => ({ distributionService: mocks.distribution }));
vi.mock('../services/record-access.service.js', () => ({
    recordAccessService: mocks.recordAccess,
    allowedSecurityClassifications: () => ['biasa', 'terbatas'],
    isAllowedForClassification: () => true,
}));
vi.mock('../services/audit-log.service.js', () => ({
    default: { logAction: vi.fn(), logActionOrThrow: vi.fn() },
}));

// validate.middleware TIDAK di-mock: skema Zod asli yang diuji.
const { default: distributionRouter } = await import('../routes/distribution.routes.js');

const app = express();
app.use(express.json());
app.use('/distributions', distributionRouter);

const BASE = {
    suratMasukId: '550e8400-e29b-41d4-a716-446655440001',
    sourceUnitId: 'ditjen',
    targetUnitId: 'dir_bppt',
};

describe('POST /distributions dengan validator asli', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.recordAccess.check.mockResolvedValue({
            exists: true, allowed: true, mutable: true, unitKerjaId: 'ditjen', classification: 'biasa',
        });
        mocks.distribution.distribute.mockResolvedValue({ id: 'dist-1', status: 'sent' });
    });

    it('menerima instruction: null persis seperti yang dikirim DistributeDialog', async () => {
        const res = await request(app).post('/distributions').send({ ...BASE, instruction: null });
        expect(res.status).toBe(201);
        expect(mocks.distribution.distribute).toHaveBeenCalledWith(
            expect.objectContaining({ ...BASE, instruction: null }),
            expect.objectContaining({ userId: 'user-1' }),
        );
    });

    it('menerima distribusi tanpa field instruction', async () => {
        const res = await request(app).post('/distributions').send(BASE);
        expect(res.status).toBe(201);
        expect(mocks.distribution.distribute.mock.calls[0][0].instruction).toBeUndefined();
    });

    it('tetap menerima instruksi berupa string', async () => {
        const res = await request(app).post('/distributions').send({ ...BASE, instruction: 'Mohon ditindaklanjuti' });
        expect(res.status).toBe(201);
        expect(mocks.distribution.distribute.mock.calls[0][0].instruction).toBe('Mohon ditindaklanjuti');
    });

    it.each([
        ['angka', 123],
        ['objek', { text: 'x' }],
        ['array', ['a']],
        ['2001 karakter', 'x'.repeat(2001)],
    ])('menolak instruction bertipe %s dengan 400 sebelum menyentuh service', async (_label, instruction) => {
        const res = await request(app).post('/distributions').send({ ...BASE, instruction });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Validation failed');
        expect(res.body.details.map((detail: { field: string }) => detail.field)).toContain('instruction');
        expect(mocks.recordAccess.check).not.toHaveBeenCalled();
        expect(mocks.distribution.distribute).not.toHaveBeenCalled();
    });
});
