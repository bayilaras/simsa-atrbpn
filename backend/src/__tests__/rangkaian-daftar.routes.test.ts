import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoAccessMiddleware } from '../middlewares/demo-access.middleware.js';

const mocks = vi.hoisted(() => ({
    user: { id: 'user-1', email: 'user@example.test', name: 'Pengguna', role: 'admin_unit', unitKerjaId: 'dir_bppt' as string | null },
    list: vi.fn(),
}));
vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); },
}));
vi.mock('../services/rangkaian-daftar.service.js', () => ({ rangkaianDaftarService: { list: mocks.list } }));

const { default: router } = await import('../routes/rangkaian-daftar.routes.js');
const app = express();
app.use(express.json());
app.use('/api/rangkaian', router);

describe('GET /api/rangkaian', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(mocks.user, { role: 'admin_unit', unitKerjaId: 'dir_bppt' });
        mocks.list.mockResolvedValue({ data: [{ id: 'r-1' }], pagination: { page: 2, limit: 20, total: 21, totalPages: 2 }, meta: { aksiDiizinkan: [] } });
    });

    it('meneruskan filter tervalidasi dan mengembalikan amplop standar', async () => {
        const response = await request(app).get('/api/rangkaian?status=diberkaskan&unitPengolahId=dir_bppt&page=2').expect(200);
        expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }),
            { status: 'diberkaskan', unitPengolahId: 'dir_bppt', page: 2, limit: 20 });
        expect(response.body).toEqual({ success: true, data: [{ id: 'r-1' }], pagination: { page: 2, limit: 20, total: 21, totalPages: 2 }, meta: { aksiDiizinkan: [] } });
    });

    it.each([
        ['status=digabung'],
        ['asal=lainnya'],
        ['limit=51'],
        ['page=0'],
        ['unitKerjaId=ditjen'],
    ])('menolak kueri %s dengan 400', async query => {
        await request(app).get(`/api/rangkaian?${query}`).expect(400);
        expect(mocks.list).not.toHaveBeenCalled();
    });

    it('menolak pengguna yang belum terprovisi', async () => {
        Object.assign(mocks.user, { role: 'user', unitKerjaId: null });
        await request(app).get('/api/rangkaian').expect(403);
        expect(mocks.list).not.toHaveBeenCalled();
    });

    it('mengizinkan staff/auditor (read-only) — cakupan ditentukan layanan', async () => {
        Object.assign(mocks.user, { role: 'staff', unitKerjaId: 'sesditjen' });
        await request(app).get('/api/rangkaian').expect(200);
    });
});

describe('allowlist demo metadata-only', () => {
    it('meneruskan GET /api/rangkaian dan tetap menolak POST ke koleksi', async () => {
        const demo = express();
        let downstream = 0;
        demo.use('/api', createDemoAccessMiddleware(true));
        demo.use('/api', (_req, res) => { downstream += 1; res.json({ success: true }); });
        await request(demo).get('/api/rangkaian?status=diberkaskan').expect(200);
        expect(downstream).toBe(1);
        await request(demo).post('/api/rangkaian').send({}).expect(403);
        expect(downstream).toBe(1);
    });
});
