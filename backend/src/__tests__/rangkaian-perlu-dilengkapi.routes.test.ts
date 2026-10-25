// backend/src/__tests__/rangkaian-perlu-dilengkapi.routes.test.ts
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoAccessMiddleware } from '../middlewares/demo-access.middleware.js';
import { validateIdParam } from '../middlewares/validate.middleware.js';

const ID = '550e8400-e29b-41d4-a716-446655440000';
const BATAS = '2025-12-31T17:00:00.000Z';
const mocks = vi.hoisted(() => ({
    user: { id: 'user-1', email: 'user@example.test', name: 'Pengguna', role: 'admin_unit', unitKerjaId: 'dir_bppt' as string | null },
    list: vi.fn(),
    ringkasan: vi.fn(),
    tandaiInisiatif: vi.fn(),
}));
vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); },
}));
vi.mock('../services/perlu-dilengkapi.service.js', () => ({ perluDilengkapiService: { list: mocks.list, ringkasan: mocks.ringkasan } }));
vi.mock('../services/asal-naskah.service.js', () => ({ asalNaskahService: { tandaiInisiatif: mocks.tandaiInisiatif } }));

const { default: router } = await import('../routes/rangkaian-perlu-dilengkapi.routes.js');
const app = express();
app.use(express.json());
app.use('/api/rangkaian', router);
// Router P2/P3 dengan GET /:id dipasang SETELAH router D7 (urutan app.ts); permintaan D7 tidak boleh sampai ke sini.
const routerUtama = express.Router();
routerUtama.get('/:id', validateIdParam(), (_req, res) => { res.json({ tertangkap: true }); });
app.use('/api/rangkaian', routerUtama);

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.user, { role: 'admin_unit', unitKerjaId: 'dir_bppt' });
    mocks.list.mockResolvedValue({
        data: [{ kunci: 'sk_tanpa_asal:x' }], pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
        meta: { batasDataLama: BATAS, tampilkanDataLama: true },
    });
    mocks.ringkasan.mockResolvedValue({ perKategori: { sk_tanpa_asal: 3 }, total: 3, lewatBatas: 1, batasDataLama: BATAS });
    mocks.tandaiInisiatif.mockResolvedValue({ id: ID, asalNaskah: 'inisiatif' });
});

describe('GET /api/rangkaian/perlu-dilengkapi', () => {
    it('meneruskan filter tervalidasi dan tidak tertangkap route /:id', async () => {
        const response = await request(app).get('/api/rangkaian/perlu-dilengkapi?kategori=sk_tanpa_asal&tampilkanDataLama=true&page=2').expect(200);
        expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }),
            { kategori: 'sk_tanpa_asal', tampilkanDataLama: true, page: 2, limit: 20 });
        expect(response.body).toEqual({
            success: true, data: [{ kunci: 'sk_tanpa_asal:x' }], pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
            meta: { batasDataLama: BATAS, tampilkanDataLama: true },
        });
    });

    it('bawaan: tanpa kategori dan tanpa data lama', async () => {
        await request(app).get('/api/rangkaian/perlu-dilengkapi').expect(200);
        expect(mocks.list).toHaveBeenCalledWith(expect.anything(), { tampilkanDataLama: false, page: 1, limit: 20 });
    });

    it.each(['kategori=lainnya', 'tampilkanDataLama=ya', 'limit=51', 'page=0', 'unitKerjaId=ditjen'])('menolak kueri %s dengan 400', async (query) => {
        await request(app).get(`/api/rangkaian/perlu-dilengkapi?${query}`).expect(400);
        expect(mocks.list).not.toHaveBeenCalled();
    });

    it('ringkasan hanya menerima tampilkanDataLama', async () => {
        const response = await request(app).get('/api/rangkaian/perlu-dilengkapi/ringkasan').expect(200);
        expect(mocks.ringkasan).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), { tampilkanDataLama: false });
        expect(response.body).toEqual({ success: true, data: { perKategori: { sk_tanpa_asal: 3 }, total: 3, lewatBatas: 1, batasDataLama: BATAS } });
        await request(app).get('/api/rangkaian/perlu-dilengkapi/ringkasan?kategori=sk_tanpa_asal').expect(400);
        expect(mocks.ringkasan).toHaveBeenCalledTimes(1);
    });

    it('menolak pengguna yang belum terprovisi; staff/auditor boleh membaca (cakupan ditentukan layanan)', async () => {
        Object.assign(mocks.user, { role: 'user', unitKerjaId: null });
        await request(app).get('/api/rangkaian/perlu-dilengkapi').expect(403);
        await request(app).get('/api/rangkaian/perlu-dilengkapi/ringkasan').expect(403);
        Object.assign(mocks.user, { role: 'staff', unitKerjaId: 'sesditjen' });
        await request(app).get('/api/rangkaian/perlu-dilengkapi/ringkasan').expect(200);
        expect(mocks.list).not.toHaveBeenCalled();
    });
});

describe('POST /api/rangkaian/surat-keluar/:suratKeluarId/tandai-inisiatif', () => {
    it('memanggil layanan dengan konteks audit', async () => {
        const response = await request(app).post(`/api/rangkaian/surat-keluar/${ID}/tandai-inisiatif`).send({}).expect(200);
        expect(response.body).toEqual({ success: true, data: { id: ID, asalNaskah: 'inisiatif' } });
        expect(mocks.tandaiInisiatif).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), ID,
            expect.objectContaining({ userId: 'user-1', userEmail: 'user@example.test' }));
    });

    it('tanpa body diterima; body berisi field apa pun ditolak 400', async () => {
        await request(app).post(`/api/rangkaian/surat-keluar/${ID}/tandai-inisiatif`).expect(200);
        await request(app).post(`/api/rangkaian/surat-keluar/${ID}/tandai-inisiatif`).send({ asalNaskah: 'tindak_lanjut' }).expect(400);
        expect(mocks.tandaiInisiatif).toHaveBeenCalledTimes(1);
    });

    it('id bukan UUID → 400; role read-only → 403', async () => {
        await request(app).post('/api/rangkaian/surat-keluar/bukan-uuid/tandai-inisiatif').send({}).expect(400);
        Object.assign(mocks.user, { role: 'staff', unitKerjaId: 'dir_bppt' });
        await request(app).post(`/api/rangkaian/surat-keluar/${ID}/tandai-inisiatif`).send({}).expect(403);
        expect(mocks.tandaiInisiatif).not.toHaveBeenCalled();
    });
});

describe('pemasangan dan allowlist demo', () => {
    it('router D7 dipasang setelah router daftar dan sebelum router rangkaian utama di app.ts', () => {
        const source = fs.readFileSync(path.resolve(process.cwd(), 'src/app.ts'), 'utf8');
        const daftar = source.indexOf("app.use('/api/rangkaian', rangkaianDaftarRoutes)");
        const d7 = source.indexOf("app.use('/api/rangkaian', rangkaianPerluDilengkapiRoutes)");
        const utama = source.indexOf("app.use('/api/rangkaian', rangkaianRoutes)");
        expect(daftar).toBeGreaterThan(-1);
        expect(d7).toBeGreaterThan(daftar);
        expect(utama).toBeGreaterThan(d7);
    });

    it('meneruskan GET daftar/ringkasan dan POST tandai-inisiatif, menolak id bukan UUID', async () => {
        const demo = express();
        let downstream = 0;
        demo.use('/api', createDemoAccessMiddleware(true));
        demo.use('/api', (_req, res) => { downstream += 1; res.json({ success: true }); });
        await request(demo).get('/api/rangkaian/perlu-dilengkapi?tampilkanDataLama=true').expect(200);
        await request(demo).get('/api/rangkaian/perlu-dilengkapi/ringkasan').expect(200);
        await request(demo).post(`/api/rangkaian/surat-keluar/${ID}/tandai-inisiatif`).send({}).expect(200);
        expect(downstream).toBe(3);
        await request(demo).post('/api/rangkaian/surat-keluar/bukan-uuid/tandai-inisiatif').send({}).expect(403);
        expect(downstream).toBe(3);
    });
});
