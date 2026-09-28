import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    update: vi.fn(),
    user: {
        id: '550e8400-e29b-41d4-a716-446655440010',
        email: 'super@example.test',
        role: 'super_admin',
        unitKerjaId: null as string | null,
    },
}));
vi.mock('../config/database', () => ({ db: {} }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); },
}));
vi.mock('../services/settings.service', () => ({ settingsService: { updateUnitKerja: mocks.update } }));

const { settingsRoutes } = await import('../routes/settings.routes');
const app = express();
app.use(express.json());
app.use('/api/settings', settingsRoutes);

describe('PUT /api/settings/unit-kerja/:id — Unit Pengawas (pencatat terpusat)', () => {
    beforeEach(() => {
        mocks.update.mockReset().mockResolvedValue({ id: 'dir_bppt', isUnitPengawas: true });
        mocks.user.role = 'super_admin';
        mocks.user.unitKerjaId = null;
    });

    it('super_admin menyalakan penanda; konteks audit diteruskan ke layanan', async () => {
        const res = await request(app).put('/api/settings/unit-kerja/dir_bppt').send({ isUnitPengawas: true }).expect(200);
        expect(res.body).toMatchObject({ isUnitPengawas: true });
        expect(mocks.update).toHaveBeenCalledWith(
            'dir_bppt',
            expect.objectContaining({ isUnitPengawas: true }),
            expect.objectContaining({ userId: mocks.user.id, userEmail: mocks.user.email }),
        );
    });

    it('menolak nilai non-boolean (400) tanpa memanggil layanan', async () => {
        await request(app).put('/api/settings/unit-kerja/dir_bppt').send({ isUnitPengawas: 'true' }).expect(400);
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('admin_unit (termasuk unit pengawas) tidak dapat mengubah penanda (403)', async () => {
        mocks.user.role = 'admin_unit';
        mocks.user.unitKerjaId = 'sesditjen';
        await request(app).put('/api/settings/unit-kerja/sesditjen').send({ isUnitPengawas: false }).expect(403);
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('tanpa field isUnitPengawas, nilai tersimpan tidak disentuh', async () => {
        await request(app).put('/api/settings/unit-kerja/dir_bppt').send({ name: 'Dit. BPPT' }).expect(200);
        expect(mocks.update.mock.calls[0][1].isUnitPengawas).toBeUndefined();
    });
});
