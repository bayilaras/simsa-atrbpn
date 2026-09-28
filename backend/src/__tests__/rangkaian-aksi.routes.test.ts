import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    tutup: vi.fn(),
    berkas: { tandaiSelesai: vi.fn(), bukaKembali: vi.fn(), berkaskan: vi.fn(), ubahUnitPengolah: vi.fn(), opsiBerkas: vi.fn() },
    user: { id: 'user-tu', email: 't@example.test', name: 'T', role: 'admin_unit', unitKerjaId: 'sesditjen' },
}));
vi.mock('../config/database', () => ({ db: {} }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); },
}));
vi.mock('../services/distribution.service.js', () => ({ distributionService: { tutupOlehPengawas: mocks.tutup } }));
vi.mock('../services/rangkaian/berkas.service.js', () => ({ berkasService: mocks.berkas }));

const { default: router } = await import('../routes/rangkaian.routes');
const app = express();
app.use(express.json());
app.use('/api/rangkaian', router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ error: error.message }));

const DIST = '550e8400-e29b-41d4-a716-446655440000';

describe('POST /api/rangkaian/disposisi/:distribusiId/tutup', () => {
    beforeEach(() => {
        mocks.tutup.mockReset().mockResolvedValue({ id: DIST, status: 'processed', ditutupPengawas: true });
        mocks.user.role = 'admin_unit';
    });

    it('meneruskan alasan dan aktor ke layanan', async () => {
        const res = await request(app).post(`/api/rangkaian/disposisi/${DIST}/tutup`).send({ alasan: 'Target tidak dapat memproses surat lama' }).expect(200);
        expect(res.body.data).toMatchObject({ ditutupPengawas: true });
        expect(mocks.tutup).toHaveBeenCalledWith(DIST, expect.objectContaining({ id: 'user-tu' }), 'Target tidak dapat memproses surat lama', expect.objectContaining({ userId: 'user-tu' }));
    });

    it('400 untuk alasan < 10 karakter atau id bukan UUID', async () => {
        await request(app).post(`/api/rangkaian/disposisi/${DIST}/tutup`).send({ alasan: 'singkat' }).expect(400);
        await request(app).post('/api/rangkaian/disposisi/xyz/tutup').send({ alasan: 'Target tidak dapat memproses' }).expect(400);
        expect(mocks.tutup).not.toHaveBeenCalled();
    });

    it('403 untuk role read-only', async () => {
        mocks.user.role = 'staff';
        await request(app).post(`/api/rangkaian/disposisi/${DIST}/tutup`).send({ alasan: 'Target tidak dapat memproses' }).expect(403);
    });
});

const RS = '650e8400-e29b-41d4-a716-446655440000';

describe('aksi berkas rangkaian', () => {
    beforeEach(() => {
        for (const fn of Object.values(mocks.berkas)) (fn as any).mockReset().mockResolvedValue({ id: RS });
        mocks.user.role = 'admin_unit';
    });

    it('berkaskan wajib konfirmasi dua langkah (400 tanpa konfirmasi)', async () => {
        await request(app).post(`/api/rangkaian/${RS}/berkaskan`).send({ unitPengolahId: 'dir_bppt', klasifikasiItemId: 5 }).expect(400);
        await request(app).post(`/api/rangkaian/${RS}/berkaskan`).send({ unitPengolahId: 'dir_bppt', klasifikasiItemId: 5, konfirmasi: true }).expect(200);
        expect(mocks.berkas.berkaskan).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-tu' }), RS,
            { unitPengolahId: 'dir_bppt', klasifikasiItemId: 5, konfirmasi: true }, expect.objectContaining({ userId: 'user-tu' }));
    });

    it('tandai selesai wajib catatan ≥10; buka kembali wajib alasan ≥10', async () => {
        await request(app).post(`/api/rangkaian/${RS}/selesai`).send({ catatan: 'singkat' }).expect(400);
        await request(app).post(`/api/rangkaian/${RS}/selesai`).send({ catatan: 'Ditangani lewat rapat koordinasi' }).expect(200);
        expect(mocks.berkas.tandaiSelesai).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-tu' }), RS,
            'Ditangani lewat rapat koordinasi', expect.objectContaining({ userId: 'user-tu' }));
        await request(app).post(`/api/rangkaian/${RS}/buka-kembali`).send({ alasan: 'pendek' }).expect(400);
        await request(app).post(`/api/rangkaian/${RS}/buka-kembali`).send({ alasan: 'Ada surat susulan dari Pemda' }).expect(200);
        expect(mocks.berkas.bukaKembali).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-tu' }), RS,
            'Ada surat susulan dari Pemda', expect.objectContaining({ userId: 'user-tu' }));
    });

    it('ubah unit pengolah dan opsi berkas', async () => {
        await request(app).put(`/api/rangkaian/${RS}/unit-pengolah`).send({ unitPengolahId: 'dir_ptep' }).expect(200);
        expect(mocks.berkas.ubahUnitPengolah).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-tu' }), RS,
            'dir_ptep', expect.objectContaining({ userId: 'user-tu' }));
        await request(app).get(`/api/rangkaian/${RS}/opsi-berkas`).expect(200);
        expect(mocks.berkas.opsiBerkas).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-tu' }), RS);
    });

    it('id bukan UUID ditolak 400; role read-only 403 untuk aksi tulis tetapi boleh membaca opsi', async () => {
        await request(app).post('/api/rangkaian/xyz/selesai').send({ catatan: 'Ditangani lewat rapat koordinasi' }).expect(400);
        await request(app).get('/api/rangkaian/xyz/opsi-berkas').expect(400);
        mocks.user.role = 'staff';
        await request(app).post(`/api/rangkaian/${RS}/selesai`).send({ catatan: 'Ditangani lewat rapat koordinasi' }).expect(403);
        await request(app).post(`/api/rangkaian/${RS}/buka-kembali`).send({ alasan: 'Ada surat susulan dari Pemda' }).expect(403);
        await request(app).post(`/api/rangkaian/${RS}/berkaskan`).send({ unitPengolahId: 'dir_bppt', klasifikasiItemId: 5, konfirmasi: true }).expect(403);
        await request(app).put(`/api/rangkaian/${RS}/unit-pengolah`).send({ unitPengolahId: 'dir_ptep' }).expect(403);
        for (const fn of ['tandaiSelesai', 'bukaKembali', 'berkaskan', 'ubahUnitPengolah'] as const) expect(mocks.berkas[fn]).not.toHaveBeenCalled();
        await request(app).get(`/api/rangkaian/${RS}/opsi-berkas`).expect(200);
    });
});
