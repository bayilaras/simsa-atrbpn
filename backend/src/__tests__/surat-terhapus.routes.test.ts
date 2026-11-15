import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    user: { id: 'sa-1', email: 'sa@example.test', role: 'super_admin', unitKerjaId: null as string | null },
    daftar: vi.fn(),
    pulihkan: vi.fn(),
}));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => { req.user = mocks.user; next(); },
}));
vi.mock('../middlewares/rate-limiter.middleware', () => ({ sensitiveLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/surat-terhapus.service', () => ({
    suratTerhapusService: { daftar: mocks.daftar, pulihkan: mocks.pulihkan },
}));

const { default: router } = await import('../routes/surat-terhapus.routes');
const app = express();
app.use(express.json());
app.use('/api/surat-terhapus', router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ error: error.name, message: error.message }));

const ID = '550e8400-e29b-41d4-a716-446655440000';
const ALASAN = 'Salah hapus, surat masih dipakai';

describe('rute Surat Terhapus (khusus Super Admin)', () => {
    beforeEach(() => {
        mocks.user = { id: 'sa-1', email: 'sa@example.test', role: 'super_admin', unitKerjaId: null };
        mocks.daftar.mockReset().mockResolvedValue({ data: [{ id: ID }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });
        mocks.pulihkan.mockReset().mockResolvedValue({ id: ID, nomorSurat: 'SM-1/2026', perihal: 'Uji' });
    });

    it.each(['admin_unit', 'admin_dirjen', 'staff', 'auditor'])('peran %s ditolak untuk daftar dan pemulihan', async (role) => {
        mocks.user = { id: 'u-1', email: 'u@example.test', role, unitKerjaId: 'sesditjen' };
        await request(app).get('/api/surat-terhapus/masuk').expect(403);
        await request(app).post(`/api/surat-terhapus/masuk/${ID}/pulihkan`).send({ alasan: ALASAN }).expect(403);
        expect(mocks.daftar).not.toHaveBeenCalled();
        expect(mocks.pulihkan).not.toHaveBeenCalled();
    });

    it('daftar meneruskan jenis, unit pilihan, pencarian, dan plafon kelas', async () => {
        const res = await request(app).get('/api/surat-terhapus/keluar?unitKerjaId=dir_bppt&search=nota&page=2&limit=10').expect(200);
        expect(res.body).toMatchObject({ success: true, data: [{ id: ID }] });
        expect(mocks.daftar).toHaveBeenCalledWith('surat_keluar', {
            unitKerjaId: 'dir_bppt', search: 'nota', page: 2, limit: 10,
            securityClassifications: ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'],
        });
    });

    it('jenis yang tidak dikenal dan parameter tidak sah ditolak', async () => {
        await request(app).get('/api/surat-terhapus/arsip').expect(404);
        await request(app).get('/api/surat-terhapus/masuk?limit=1000').expect(400);
        await request(app).post(`/api/surat-terhapus/arsip/${ID}/pulihkan`).send({ alasan: ALASAN }).expect(404);
        await request(app).post('/api/surat-terhapus/masuk/bukan-uuid/pulihkan').send({ alasan: ALASAN }).expect(400);
        expect(mocks.pulihkan).not.toHaveBeenCalled();
    });

    it('pemulihan mewajibkan alasan minimal 10 karakter', async () => {
        const res = await request(app).post(`/api/surat-terhapus/masuk/${ID}/pulihkan`).send({ alasan: 'pendek' }).expect(400);
        expect(res.body.details).toEqual([{ field: 'alasan', message: 'Alasan minimal 10 karakter' }]);
        await request(app).post(`/api/surat-terhapus/masuk/${ID}/pulihkan`).send({}).expect(400);
        expect(mocks.pulihkan).not.toHaveBeenCalled();
    });

    it('pemulihan meneruskan pelaku dan konteks audit, lalu menjawab data surat', async () => {
        const res = await request(app).post(`/api/surat-terhapus/masuk/${ID}/pulihkan`).send({ alasan: `  ${ALASAN} ` }).expect(200);
        expect(res.body).toMatchObject({ success: true, data: { id: ID, nomorSurat: 'SM-1/2026' } });
        expect(mocks.pulihkan).toHaveBeenCalledWith('surat_masuk', ID, mocks.user, ALASAN,
            expect.objectContaining({ userId: 'sa-1', userEmail: 'sa@example.test' }));
    });

    it('penolakan layanan diteruskan sebagai galat berpesan Indonesia', async () => {
        const { ConflictError } = await import('../utils/errors');
        mocks.pulihkan.mockRejectedValue(new ConflictError('Surat ini bagian dari berkas rangkaian yang sudah diberkaskan, sehingga tidak dapat dipulihkan.'));
        const res = await request(app).post(`/api/surat-terhapus/keluar/${ID}/pulihkan`).send({ alasan: ALASAN }).expect(409);
        expect(res.body.message).toContain('sudah diberkaskan');
    });
});
