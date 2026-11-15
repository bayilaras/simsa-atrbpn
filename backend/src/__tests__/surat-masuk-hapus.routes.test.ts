import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findById: vi.fn(), del: vi.fn(), check: vi.fn() }));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-tu', email: 't@example.test', name: 'T', role: 'admin_unit', unitKerjaId: 'sesditjen' };
        next();
    },
}));
vi.mock('../middlewares/role.middleware', () => ({ canWriteMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/surat-masuk.service', () => ({
    suratMasukService: { findById: mocks.findById, delete: mocks.del },
}));
vi.mock('../services/record-access.service.js', () => ({
    allowedSecurityClassifications: () => ['biasa', 'terbatas'],
    isAllowedForClassification: () => true,
    normalizeSecurityClassification: (value?: string | null) => String(value ?? 'biasa').toLowerCase(),
    recordAccessService: { check: mocks.check },
}));

const { default: router } = await import('../routes/surat-masuk.routes');
const app = express();
app.use(express.json());
app.use('/api/surat-masuk', router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ error: error.message }));

const ID = '550e8400-e29b-41d4-a716-446655440001';
const ALASAN = 'Surat ganda, sudah dicatat ulang';

describe('DELETE /api/surat-masuk/:id yang tidak menemukan surat', () => {
    beforeEach(() => {
        mocks.findById.mockReset().mockResolvedValue({ id: ID, unitKerjaId: 'sesditjen', isArchived: false, sifatSurat: 'biasa' });
        mocks.del.mockReset().mockResolvedValue({ id: ID, isDeleted: true });
        mocks.check.mockReset().mockResolvedValue({ exists: true, mutable: true });
    });

    it('menghapus surat yang ada dengan alasannya', async () => {
        await request(app).delete(`/api/surat-masuk/${ID}`).send({ alasan: ALASAN }).expect(200);
        expect(mocks.del).toHaveBeenCalledWith(ID, 'user-tu', 'sesditjen', expect.objectContaining({ userId: 'user-tu' }), { alasan: ALASAN });
    });

    it.each([
        ['surat tidak ada', () => mocks.findById.mockResolvedValue(null)],
        ['surat tidak boleh diubah', () => mocks.check.mockResolvedValue({ exists: true, mutable: false })],
        ['surat sudah terhapus saat ditulis', () => mocks.del.mockResolvedValue(undefined)],
    ])('404 karena %s membawa pesan berbahasa Indonesia', async (_label, siapkan) => {
        siapkan();
        const res = await request(app).delete(`/api/surat-masuk/${ID}`).send({ alasan: ALASAN }).expect(404);
        expect(res.body).toEqual({ error: 'Surat masuk not found', message: 'Surat tidak ditemukan atau sudah dihapus. Muat ulang daftar.' });
    });
});
