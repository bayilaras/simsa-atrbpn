import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), check: vi.fn() }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-bppt', email: 'b@example.test', name: 'B', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
        next();
    },
}));
vi.mock('../middlewares/role.middleware', () => ({ canWriteMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: { create: mocks.create } }));
vi.mock('../services/record-access.service.js', () => ({
    allowedSecurityClassifications: () => ['biasa', 'terbatas'],
    isAllowedForClassification: () => true,
    recordAccessService: { check: mocks.check },
}));

const { default: router } = await import('../routes/surat-keluar.routes');
const app = express();
app.use(express.json());
app.use('/api/surat-keluar', router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ error: error.message }));

const INDUK = '550e8400-e29b-41d4-a716-446655440000';
const dasar = { unitKerjaId: 'dir_bppt', tanggalSurat: '2026-09-20', perihal: 'Tindak lanjut', kepada: 'Dirjen', naskahDinas: 'Nota Dinas' };

describe('POST /api/surat-keluar tindak lanjut', () => {
    beforeEach(() => {
        mocks.create.mockReset().mockResolvedValue({ id: 'sk-1', unitKerjaId: 'dir_bppt' });
        mocks.check.mockReset();
    });

    it('400 untuk inisiatif bersama induk', async () => {
        await request(app).post('/api/surat-keluar').send({ ...dasar, asalNaskah: 'inisiatif', balasanUntuk: INDUK }).expect(400);
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('meneruskan tindakLanjut dan aktor tanpa pra-cek pemilik (wewenang di hook)', async () => {
        await request(app).post('/api/surat-keluar')
            .send({ ...dasar, tindakLanjut: { jenis: 'surat_masuk', suratId: INDUK, jenisRelasi: 'tindak_lanjut' } }).expect(201);
        expect(mocks.check).not.toHaveBeenCalled();
        expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
            tindakLanjut: { jenis: 'surat_masuk', suratId: INDUK, jenisRelasi: 'tindak_lanjut' },
            asalNaskah: 'tindak_lanjut',
            actor: expect.objectContaining({ id: 'user-bppt' }),
        }), expect.anything(), undefined, undefined);
    });

    it('balasanUntuk klien lama dipetakan ke relasi balasan dan diteruskan ke layanan', async () => {
        await request(app).post('/api/surat-keluar').send({ ...dasar, balasanUntuk: INDUK }).expect(201);
        expect(mocks.check).not.toHaveBeenCalled();
        const [data] = mocks.create.mock.calls[0];
        expect(data).toMatchObject({
            tindakLanjut: { jenis: 'surat_masuk', suratId: INDUK, jenisRelasi: 'balasan' },
            asalNaskah: 'tindak_lanjut',
            unitKerjaId: 'dir_bppt',
        });
        expect(data).not.toHaveProperty('balasanUntuk');
    });
});
