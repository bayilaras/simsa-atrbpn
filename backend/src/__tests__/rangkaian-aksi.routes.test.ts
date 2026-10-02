import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    tutup: vi.fn(),
    berkas: { tandaiSelesai: vi.fn(), bukaKembali: vi.fn(), berkaskan: vi.fn(), ubahUnitPengolah: vi.fn(), opsiBerkas: vi.fn() },
    link: { tautan: vi.fn(), tautanKeSurat: vi.fn(), gabung: vi.fn(), pratinjau: vi.fn(), pratinjauGabung: vi.fn(), batalRelasi: vi.fn() },
    user: { id: 'user-tu', email: 't@example.test', name: 'T', role: 'admin_unit', unitKerjaId: 'sesditjen' },
}));
vi.mock('../config/database', () => ({ db: {} }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); },
}));
vi.mock('../services/distribution.service.js', () => ({ distributionService: { tutupOlehPengawas: mocks.tutup } }));
vi.mock('../services/rangkaian/berkas.service.js', () => ({ berkasService: mocks.berkas }));
vi.mock('../services/rangkaian/rangkaian-link.service.js', () => ({ rangkaianLinkService: mocks.link }));

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

describe('tautan, gabung, batal', () => {
    beforeEach(() => {
        for (const fn of Object.values(mocks.link)) (fn as any).mockReset();
        mocks.user.role = 'admin_unit';
    });

    it('gabung wajib alasan ≥10; batal relasi wajib alasan ≥10; pratinjau wajib sumberId UUID', async () => {
        mocks.link.gabung.mockResolvedValue({ targetId: RS });
        mocks.link.batalRelasi.mockResolvedValue({ id: DIST, cancelled: true });
        await request(app).post(`/api/rangkaian/${RS}/gabung`).send({ sumberId: DIST, alasan: 'pendek' }).expect(400);
        await request(app).post(`/api/rangkaian/${RS}/gabung`).send({ sumberId: DIST, alasan: 'TU lupa Nomor Referensi' }).expect(200);
        expect(mocks.link.gabung).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-tu' }), RS,
            { sumberId: DIST, alasan: 'TU lupa Nomor Referensi' }, expect.objectContaining({ userId: 'user-tu' }));
        await request(app).post(`/api/rangkaian/relasi/${DIST}/batal`).send({ alasan: 'x' }).expect(400);
        await request(app).post(`/api/rangkaian/relasi/${DIST}/batal`).send({ alasan: 'Balasan salah ditautkan' }).expect(200);
        expect(mocks.link.batalRelasi).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-tu' }), DIST,
            'Balasan salah ditautkan', expect.objectContaining({ userId: 'user-tu' }));
        await request(app).get(`/api/rangkaian/${RS}/gabung/pratinjau`).expect(400);
        expect(mocks.link.pratinjau).not.toHaveBeenCalled();
    });

    it('pratinjau: sumberId berisi tanda hubung saja ditolak 400 (T15-10), UUID sah diteruskan dengan pengguna', async () => {
        await request(app).get(`/api/rangkaian/${RS}/gabung/pratinjau`).query({ sumberId: '------------------------------------' }).expect(400);
        expect(mocks.link.pratinjau).not.toHaveBeenCalled();
        mocks.link.pratinjau.mockResolvedValue({ unitBaruDiTarget: ['dir_ptep'], unitBaruDiSumber: [] });
        const res = await request(app).get(`/api/rangkaian/${RS}/gabung/pratinjau`).query({ sumberId: DIST }).expect(200);
        expect(res.body.data).toEqual({ unitBaruDiTarget: ['dir_ptep'], unitBaruDiSumber: [] });
        expect(mocks.link.pratinjau).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-tu' }), RS, DIST);
    });

    it('POST /tautan tidak tertangkap route /:id/tautan dan meneruskan payload', async () => {
        mocks.link.tautanKeSurat.mockResolvedValue({ rangkaianId: RS });
        const payload = { jenis: 'surat_keluar', suratId: DIST, keJenis: 'surat_keluar', keSuratId: RS, jenisRelasi: 'menjelaskan' };
        await request(app).post('/api/rangkaian/tautan').send(payload).expect(201);
        expect(mocks.link.tautanKeSurat).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-tu' }), payload, expect.objectContaining({ userId: 'user-tu' }));
        expect(mocks.link.tautan).not.toHaveBeenCalled();
        await request(app).post('/api/rangkaian/tautan').send({ ...payload, keJenis: 'arsip' }).expect(400);
    });

    it('POST /:id/tautan meneruskan payload; status 404/403 dari layanan diteruskan apa adanya (T15-3)', async () => {
        const payload = { jenis: 'surat_keluar', suratId: DIST, keAnggotaId: RS, jenisRelasi: 'tindak_lanjut' };
        mocks.link.tautan.mockResolvedValue({ rangkaianId: RS, relasiId: DIST, digabungDari: null });
        await request(app).post(`/api/rangkaian/${RS}/tautan`).send(payload).expect(201);
        expect(mocks.link.tautan).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-tu' }), RS, payload, expect.objectContaining({ userId: 'user-tu' }));
        mocks.link.tautan.mockRejectedValueOnce(Object.assign(new Error('Rangkaian tidak ditemukan'), { statusCode: 404 }));
        await request(app).post(`/api/rangkaian/${RS}/tautan`).send(payload).expect(404);
        mocks.link.tautan.mockRejectedValueOnce(Object.assign(new Error('Unit Anda bukan peserta rangkaian tujuan.'), { statusCode: 403 }));
        await request(app).post(`/api/rangkaian/${RS}/tautan`).send(payload).expect(403);
        await request(app).post(`/api/rangkaian/${RS}/tautan`).send({ ...payload, jenisRelasi: 'lainnya' }).expect(400);
    });

    it('role read-only 403 untuk semua aksi tautan/gabung/batal/pratinjau; id bukan UUID 400', async () => {
        await request(app).post('/api/rangkaian/xyz/gabung').send({ sumberId: DIST, alasan: 'TU lupa Nomor Referensi' }).expect(400);
        await request(app).post('/api/rangkaian/relasi/xyz/batal').send({ alasan: 'Balasan salah ditautkan' }).expect(400);
        mocks.user.role = 'staff';
        await request(app).post(`/api/rangkaian/${RS}/gabung`).send({ sumberId: DIST, alasan: 'TU lupa Nomor Referensi' }).expect(403);
        await request(app).post(`/api/rangkaian/relasi/${DIST}/batal`).send({ alasan: 'Balasan salah ditautkan' }).expect(403);
        await request(app).get(`/api/rangkaian/${RS}/gabung/pratinjau`).query({ sumberId: DIST }).expect(403);
        await request(app).post('/api/rangkaian/tautan').send({ jenis: 'surat_keluar', suratId: DIST, keJenis: 'surat_keluar', keSuratId: RS, jenisRelasi: 'menjelaskan' }).expect(403);
        for (const fn of Object.values(mocks.link)) expect(fn).not.toHaveBeenCalled();
    });
});
