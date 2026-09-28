import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    tutup: vi.fn(),
    user: { id: 'user-tu', email: 't@example.test', name: 'T', role: 'admin_unit', unitKerjaId: 'sesditjen' },
}));
vi.mock('../config/database', () => ({ db: {} }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); },
}));
vi.mock('../services/distribution.service.js', () => ({ distributionService: { tutupOlehPengawas: mocks.tutup } }));

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
