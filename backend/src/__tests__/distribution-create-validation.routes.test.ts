import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTRUKSI_DISPOSISI } from '../config/instruksi-disposisi.js';

const mocks = vi.hoisted(() => ({
    distribution: { distributeMany: vi.fn() },
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

function expectDistributeMany(instruksi: string | null) {
    expect(mocks.distribution.distributeMany).toHaveBeenCalledWith(
        expect.objectContaining({ suratMasukId: BASE.suratMasukId, sourceUnitId: 'ditjen',
            targets: [{ unitKerjaId: 'dir_bppt', batasWaktu: null, penanggungJawab: false }], instruksi }),
        expect.objectContaining({ userId: 'user-1' }));
}

describe('POST /distributions dengan validator asli', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.recordAccess.check.mockResolvedValue({
            exists: true, allowed: true, mutable: true, unitKerjaId: 'ditjen', classification: 'biasa',
        });
        mocks.distribution.distributeMany.mockResolvedValue([{ id: 'dist-1', status: 'sent' }]);
    });

    it('menerima instruction: null persis seperti yang dikirim DistributeDialog', async () => {
        const res = await request(app).post('/distributions').send({ ...BASE, instruction: null });
        expect(res.status).toBe(201);
        expectDistributeMany(null);
        expect(res.body.data).toEqual({ id: 'dist-1', status: 'sent' });
    });

    it('menerima distribusi tanpa field instruction', async () => {
        const res = await request(app).post('/distributions').send(BASE);
        expect(res.status).toBe(201);
        expectDistributeMany(null);
        expect(res.body.data).toEqual({ id: 'dist-1', status: 'sent' });
    });

    it('tetap menerima instruksi berupa string', async () => {
        const res = await request(app).post('/distributions').send({ ...BASE, instruction: 'Mohon ditindaklanjuti' });
        expect(res.status).toBe(201);
        expectDistributeMany('Mohon ditindaklanjuti');
        expect(res.body.data).toEqual({ id: 'dist-1', status: 'sent' });
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
        expect(mocks.distribution.distributeMany).not.toHaveBeenCalled();
    });

    it('bentuk jamak memakai targets dan mengembalikan array', async () => {
        mocks.distribution.distributeMany.mockResolvedValue([{ id: 'dist-1' }, { id: 'dist-2' }]);
        const { targetUnitId: _abaikan, ...tanpaTarget } = BASE;
        const res = await request(app).post('/distributions').send({ ...tanpaTarget,
            targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep' }] });
        expect(res.status).toBe(201);
        expect(res.body.data).toEqual([{ id: 'dist-1' }, { id: 'dist-2' }]);
        expect(mocks.distribution.distributeMany.mock.calls[0][0].targets).toEqual([
            { unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep', penanggungJawab: false }]);
    });

    it('menolak targetUnitId bersama targets dengan 400', async () => {
        const res = await request(app).post('/distributions').send({ ...BASE, targets: [{ unitKerjaId: 'dir_ptep' }] });
        expect(res.status).toBe(400);
        expect(mocks.distribution.distributeMany).not.toHaveBeenCalled();
    });
});

describe('GET /distributions/opsi', () => {
    afterEach(() => { delete process.env.RANGKAIAN_AJUKAN_AKSES; });

    it('mengembalikan chip instruksi statis dan status jalur akses terkendali', async () => {
        const mati = await request(app).get('/distributions/opsi');
        expect(mati.status).toBe(200);
        expect(mati.body).toEqual({ success: true, data: { instruksi: [...INSTRUKSI_DISPOSISI], jalurAksesTerkendali: false } });
        process.env.RANGKAIAN_AJUKAN_AKSES = 'true';
        const nyala = await request(app).get('/distributions/opsi');
        expect(nyala.body.data.jalurAksesTerkendali).toBe(true);
    });
});
