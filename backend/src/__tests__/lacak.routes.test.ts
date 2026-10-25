import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    search: vi.fn(),
    user: { id: 'user-1', email: 'u@example.test', name: 'U', role: 'admin_unit', unitKerjaId: 'dir_bppt' as string | null },
}));

vi.mock('../config/database', () => ({ db: {} }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { ...mocks.user, id: req.header('x-user') || mocks.user.id };
        next();
    },
}));
vi.mock('../services/rangkaian/lacak.service.js', () => ({ lacakService: { search: mocks.search } }));

const { default: rangkaianRouter } = await import('../routes/rangkaian.routes');
const { LACAK_RATE_LIMIT_MAX } = await import('../middlewares/rate-limiter.middleware');

const app = express();
app.use(express.json());
app.use('/api/rangkaian', rangkaianRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ error: error.message }));

const kosong = { q: 'B-12', mode: 'lacak', jenisKueri: 'nomor', kelompok: [] };

describe('GET /api/rangkaian/lacak', () => {
    beforeEach(() => {
        mocks.search.mockReset().mockResolvedValue(kosong);
        mocks.user.role = 'admin_unit';
    });

    it('GET /lacak tidak tertangkap route /:id', async () => {
        const res = await request(app).get('/api/rangkaian/lacak').query({ q: 'B-12' }).set('x-user', 'route-order');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, data: kosong });
        expect(mocks.search).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'route-order' }),
            { q: 'B-12', mode: 'lacak', limit: 8 },
        );
    });

    it.each([
        [{ q: 'ab' }],
        [{ q: 'x'.repeat(101) }],
        [{ q: 'B-12', limit: '9' }],
        [{ q: 'B-12', mode: 'semua' }],
    ])('400 untuk kueri tidak sah %j', async (query) => {
        const res = await request(app).get('/api/rangkaian/lacak').query(query).set('x-user', 'validasi');
        expect(res.status).toBe(400);
        expect(mocks.search).not.toHaveBeenCalled();
    });

    it('meneruskan mode, tahun, jenis, dan limit yang sudah dikoersi', async () => {
        await request(app).get('/api/rangkaian/lacak')
            .query({ q: '  Nota  ', mode: 'referensi', tahun: '2026', jenis: 'surat_keluar', limit: '3' })
            .set('x-user', 'koersi').expect(200);
        expect(mocks.search).toHaveBeenCalledWith(expect.anything(),
            { q: 'Nota', mode: 'referensi', tahun: 2026, jenis: 'surat_keluar', limit: 3 });
    });

    it('403 untuk pengguna tanpa role terprovisi', async () => {
        mocks.user.role = 'user';
        await request(app).get('/api/rangkaian/lacak').query({ q: 'B-12' }).set('x-user', 'tanpa-role').expect(403);
    });

    it('lacakLimiter membatasi 90 permintaan/menit per pengguna', async () => {
        const pengguna = `limit-${Date.now()}`;
        for (let i = 0; i < LACAK_RATE_LIMIT_MAX; i += 1) {
            await request(app).get('/api/rangkaian/lacak').query({ q: 'B-12' }).set('x-user', pengguna).expect(200);
        }
        await request(app).get('/api/rangkaian/lacak').query({ q: 'B-12' }).set('x-user', pengguna).expect(429);
        await request(app).get('/api/rangkaian/lacak').query({ q: 'B-12' }).set('x-user', `${pengguna}-lain`).expect(200);
    });
});
