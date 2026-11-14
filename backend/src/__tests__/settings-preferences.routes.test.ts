import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    update: vi.fn(),
    user: {
        id: '550e8400-e29b-41d4-a716-446655440020',
        email: 'staf@example.test',
        role: 'user',
        unitKerjaId: 'ditjen' as string | null,
    },
}));
vi.mock('../config/database', () => ({ db: {} }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); },
}));
vi.mock('../services/settings.service', () => ({ settingsService: { updateUserPreferences: mocks.update } }));

const { settingsRoutes } = await import('../routes/settings.routes');
const app = express();
app.use(express.json());
app.use('/api/settings', settingsRoutes);

const PREFERENSI = { theme: 'dark', language: 'id', notificationsEnabled: false, emailNotifications: true };

describe('PUT /api/settings/preferences', () => {
    beforeEach(() => {
        mocks.update.mockReset().mockResolvedValue({ ...PREFERENSI, updatedAt: '2026-11-08T01:00:00.000Z' });
    });

    it('menerima keempat preferensi yang dapat diubah', async () => {
        const res = await request(app).put('/api/settings/preferences').send(PREFERENSI).expect(200);
        expect(res.body).toMatchObject(PREFERENSI);
        expect(mocks.update).toHaveBeenCalledWith(
            mocks.user.id,
            PREFERENSI,
            expect.objectContaining({ userId: mocks.user.id, userEmail: mocks.user.email }),
        );
    });

    it('menolak kunci di luar daftar preferensi (400) tanpa memanggil layanan', async () => {
        const res = await request(app)
            .put('/api/settings/preferences')
            .send({ ...PREFERENSI, updatedAt: '2026-11-01T02:00:00.000Z' })
            .expect(400);
        expect(res.body).toMatchObject({
            code: 'VALIDATION_ERROR',
            message: 'Data yang dikirim belum valid. Periksa isian berikut.',
            details: [{ field: '', message: 'Ada isian yang tidak dikenali. Muat ulang halaman, lalu coba lagi.' }],
        });
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('menolak isian kosong (400)', async () => {
        await request(app).put('/api/settings/preferences').send({}).expect(400);
        expect(mocks.update).not.toHaveBeenCalled();
    });
});
