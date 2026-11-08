import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    user: {
        id: '550e8400-e29b-41d4-a716-446655440030',
        email: 'admin@example.test',
        role: 'admin_unit',
        unitKerjaId: 'dir_bppt' as string | null,
    },
}));
// Validasi template berjalan sebelum transaksi, jadi layanan asli dipakai tanpa database.
vi.mock('../config/database', () => ({ db: {} }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => { req.user = { ...mocks.user }; next(); },
}));

const { settingsRoutes } = await import('../routes/settings.routes');
const { settingsService } = await import('../services/settings.service');
const { publicErrorResponse, publicErrorStatus } = await import('../utils/public-error.js');

const app = express();
app.use(express.json());
app.use('/api/settings', settingsRoutes);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(publicErrorStatus(error)).json(publicErrorResponse(error));
});

afterEach(() => { vi.restoreAllMocks(); });

describe('PUT /api/settings/surat-templates — galat validasi', () => {
    beforeEach(() => {
        mocks.user.role = 'admin_unit';
        mocks.user.unitKerjaId = 'dir_bppt';
    });

    it('format tanpa {noUrut} dijawab 400 beserta pesan validasinya', async () => {
        const res = await request(app)
            .put('/api/settings/surat-templates')
            .send({ unitKerjaId: 'dir_bppt', masukFormat: 'SM/{tahun}' })
            .expect(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.message).toMatch(/^Format Nomor Surat Masuk harus 3-255 karakter, memuat \{noUrut\} dan \{tahun\}/);
    });

    it('galat tak terduga tetap 500', async () => {
        vi.spyOn(settingsService, 'updateSuratTemplates').mockRejectedValue(new Error('koneksi putus'));
        const res = await request(app)
            .put('/api/settings/surat-templates')
            .send({ unitKerjaId: 'dir_bppt', masukFormat: '{noUrut}/SM/{tahun}' })
            .expect(500);
        expect(res.body).toEqual({ error: 'Failed to update templates' });
    });
});

describe('PUT /api/settings/unit-kerja/:id — nama unit', () => {
    beforeEach(() => {
        mocks.user.role = 'super_admin';
        mocks.user.unitKerjaId = null;
    });

    it.each([
        ['kosong', '', 'Nama unit kerja wajib diisi.'],
        ['hanya spasi', '   ', 'Nama unit kerja wajib diisi.'],
        ['lebih dari 255 karakter', 'U'.repeat(256), 'Nama unit kerja maksimal 255 karakter.'],
        ['bukan teks', null, 'Nama unit kerja harus berupa teks.'],
    ])('menolak nama %s (400) tanpa memanggil layanan', async (_label, name, pesan) => {
        const update = vi.spyOn(settingsService, 'updateUnitKerja');
        const res = await request(app).put('/api/settings/unit-kerja/dir_bppt').send({ name }).expect(400);
        expect(res.body.error).toBe(pesan);
        expect(update).not.toHaveBeenCalled();
    });

    it('menyimpan nama yang sudah dipangkas', async () => {
        const update = vi.spyOn(settingsService, 'updateUnitKerja').mockResolvedValue({ id: 'dir_bppt' } as any);
        await request(app).put('/api/settings/unit-kerja/dir_bppt').send({ name: '  Dit. BPPT  ' }).expect(200);
        expect(update.mock.calls[0][1].name).toBe('Dit. BPPT');
    });
});
