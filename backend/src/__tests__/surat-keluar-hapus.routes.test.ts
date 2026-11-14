import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findById: vi.fn(), del: vi.fn(), check: vi.fn() }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-bppt', email: 'b@example.test', name: 'B', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
        next();
    },
}));
vi.mock('../middlewares/role.middleware', () => ({ canWriteMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/surat-keluar.service', () => ({
    suratKeluarService: { findById: mocks.findById, delete: mocks.del },
}));
vi.mock('../services/record-access.service.js', () => ({
    allowedSecurityClassifications: () => ['biasa', 'terbatas'],
    isAllowedForClassification: () => true,
    normalizeSecurityClassification: (value?: string | null) => String(value ?? 'biasa').toLowerCase(),
    recordAccessService: { check: mocks.check },
}));

const { default: router } = await import('../routes/surat-keluar.routes');
const app = express();
app.use(express.json());
app.use('/api/surat-keluar', router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ error: error.message }));

const ID = '550e8400-e29b-41d4-a716-446655440000';

describe('DELETE /api/surat-keluar/:id mencatat alasan penghapusan', () => {
    beforeEach(() => {
        mocks.findById.mockReset().mockResolvedValue({ id: ID, unitKerjaId: 'dir_bppt', isArchived: false, approvalStatus: 'draft' });
        mocks.del.mockReset().mockResolvedValue({ id: ID, isDeleted: true });
        mocks.check.mockReset().mockResolvedValue({ exists: true, mutable: true });
    });

    it('meneruskan alasan yang sudah dirapikan ke layanan hapus', async () => {
        await request(app).delete(`/api/surat-keluar/${ID}`).send({ alasan: '  Draf ganda, sudah dibuat ulang  ' }).expect(200);
        expect(mocks.del).toHaveBeenCalledWith(ID, 'user-bppt', 'dir_bppt', expect.objectContaining({ userId: 'user-bppt' }),
            { alasan: 'Draf ganda, sudah dibuat ulang' });
    });

    it('menolak alasan yang terlalu pendek tanpa menghapus', async () => {
        const res = await request(app).delete(`/api/surat-keluar/${ID}`).send({ alasan: 'salah' }).expect(400);
        expect(res.body.details).toEqual([{ field: 'alasan', message: 'Alasan minimal 10 karakter' }]);
        expect(mocks.del).not.toHaveBeenCalled();
    });

    it('klien lama tanpa badan tetap dapat menghapus', async () => {
        await request(app).delete(`/api/surat-keluar/${ID}`).expect(200);
        expect(mocks.del).toHaveBeenCalledWith(ID, 'user-bppt', 'dir_bppt', expect.anything(), { alasan: undefined });
    });

    it('surat yang tidak boleh diubah tetap 404 sebelum badan diperiksa', async () => {
        mocks.check.mockResolvedValue({ exists: true, mutable: false });
        await request(app).delete(`/api/surat-keluar/${ID}`).send({ alasan: 'salah' }).expect(404);
        expect(mocks.del).not.toHaveBeenCalled();
    });

    it.each([
        ['surat tidak ada', () => mocks.findById.mockResolvedValue(null)],
        ['surat tidak boleh diubah', () => mocks.check.mockResolvedValue({ exists: true, mutable: false })],
        ['surat sudah terhapus saat ditulis', () => mocks.del.mockResolvedValue(undefined)],
    ])('404 karena %s membawa pesan berbahasa Indonesia', async (_label, siapkan) => {
        siapkan();
        const res = await request(app).delete(`/api/surat-keluar/${ID}`).send({ alasan: 'Draf ganda, sudah dibuat ulang' }).expect(404);
        expect(res.body).toEqual({ error: 'Surat keluar not found', message: 'Surat tidak ditemukan atau sudah dihapus. Muat ulang daftar.' });
    });
});
