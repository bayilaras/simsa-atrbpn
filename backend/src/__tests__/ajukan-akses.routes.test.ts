// backend/src/__tests__/ajukan-akses.routes.test.ts
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requestViaRangkaian: vi.fn() }));
vi.mock('../config/database', () => ({ db: {} }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-bppt', email: 'b@example.test', name: 'B', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
        next();
    },
}));
vi.mock('../services/record-access-grant.service.js', () => ({
    recordAccessGrantService: { requestViaRangkaian: mocks.requestViaRangkaian },
    default: { requestViaRangkaian: mocks.requestViaRangkaian },
}));

const { default: rangkaianRouter } = await import('../routes/rangkaian.routes');
const app = express();
app.use(express.json());
app.use('/api/rangkaian', rangkaianRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ error: error.message }));

const ANGGOTA = '550e8400-e29b-41d4-a716-446655440000';
const body = { purpose: 'Menindaklanjuti disposisi TU atas surat ini' };

describe('POST /api/rangkaian/anggota/:anggotaId/ajukan-akses', () => {
    beforeEach(() => mocks.requestViaRangkaian.mockReset().mockResolvedValue({ id: 'grant-1', status: 'pending' }));
    afterEach(() => { delete process.env.RANGKAIAN_AJUKAN_AKSES; });

    it('404 selama flag RANGKAIAN_AJUKAN_AKSES mati', async () => {
        await request(app).post(`/api/rangkaian/anggota/${ANGGOTA}/ajukan-akses`).send(body).expect(404);
        expect(mocks.requestViaRangkaian).not.toHaveBeenCalled();
    });

    it('201 dan meneruskan anggota + tujuan ketika flag menyala', async () => {
        process.env.RANGKAIAN_AJUKAN_AKSES = 'true';
        const res = await request(app).post(`/api/rangkaian/anggota/${ANGGOTA}/ajukan-akses`).send(body).expect(201);
        expect(res.body.data).toEqual({ id: 'grant-1', status: 'pending' });
        expect(mocks.requestViaRangkaian).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'user-bppt' }), ANGGOTA,
            { purpose: body.purpose, accessMode: 'view' }, expect.objectContaining({ userId: 'user-bppt' }),
        );
    });

    it('400 untuk tujuan < 20 karakter atau id bukan UUID', async () => {
        process.env.RANGKAIAN_AJUKAN_AKSES = 'true';
        await request(app).post(`/api/rangkaian/anggota/${ANGGOTA}/ajukan-akses`).send({ purpose: 'singkat' }).expect(400);
        await request(app).post('/api/rangkaian/anggota/bukan-uuid/ajukan-akses').send(body).expect(400);
    });
});
