import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSudahBerubahError } from '../utils/errors.js';
import { publicErrorResponse, publicErrorStatus } from '../utils/public-error.js';

// Versi data (updatedAt) yang dimuat formulir ubah surat dan dialog Ubah Metadata arsip.
const ID = '550e8400-e29b-41d4-a716-446655440000';
const DIMUAT = '2026-03-02T10:00:00.123Z';
const mocks = vi.hoisted(() => ({
    masuk: { update: vi.fn(), findById: vi.fn(), findArsipId: vi.fn(async () => null) },
    keluar: { update: vi.fn(), findById: vi.fn(), findArsipId: vi.fn(async () => null) },
    arsip: { findById: vi.fn(), update: vi.fn() },
}));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-tu', email: 'tu@example.test', name: 'TU', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
        next();
    },
}));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: mocks.masuk }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: mocks.keluar }));
vi.mock('../services/arsip.service', () => ({ arsipService: mocks.arsip }));
vi.mock('../services/record-access.service.js', () => ({
    allowedSecurityClassifications: () => ['biasa', 'terbatas'],
    isAllowedForClassification: () => true,
    normalizeSecurityClassification: (value: string | null) => (value ?? 'biasa').toLowerCase(),
    recordAccessService: { check: vi.fn(async () => ({ exists: true, allowed: true, mutable: true, unitKerjaId: 'dir_bppt', classification: 'biasa' })) },
}));
vi.mock('../config/database', () => ({ db: {} }));

const { default: suratMasukRouter } = await import('../routes/surat-masuk.routes');
const { default: suratKeluarRouter } = await import('../routes/surat-keluar.routes');
const { default: arsipRouter } = await import('../routes/arsip.routes');
const app = express();
app.use(express.json());
app.use('/api/surat-masuk', suratMasukRouter);
app.use('/api/surat-keluar', suratKeluarRouter);
app.use('/api/arsip', arsipRouter);
// Same treatment of AppError as the global handler in app.ts.
app.use((error: unknown, _req: any, res: any, _next: any) => res.status(publicErrorStatus(error)).json(publicErrorResponse(error)));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.masuk.findById.mockResolvedValue({ id: ID, unitKerjaId: 'dir_bppt', isArchived: false, sifatSurat: 'biasa', filePath: null });
    mocks.masuk.update.mockResolvedValue({ id: ID });
    mocks.keluar.findById.mockResolvedValue({ id: ID, unitKerjaId: 'dir_bppt', isArchived: false, approvalStatus: 'draft', klasifikasiKeamanan: 'biasa', filePath: null });
    mocks.keluar.update.mockResolvedValue({ id: ID });
    mocks.arsip.findById.mockResolvedValue({ id: ID, unitKerjaId: 'dir_bppt', klasifikasiKeamanan: 'biasa', storageLocationId: null });
    mocks.arsip.update.mockResolvedValue({ id: ID, keterangan: 'Koreksi' });
});

describe('versi data yang dimuat formulir ubah', () => {
    it('surat masuk dan surat keluar: versi diteruskan ke layanan sebagai Date', async () => {
        await request(app).put(`/api/surat-masuk/${ID}`).send({ perihal: 'Koreksi', expectedUpdatedAt: DIMUAT }).expect(200);
        expect(mocks.masuk.update.mock.calls[0][1]).toEqual({ perihal: 'Koreksi', expectedUpdatedAt: new Date(DIMUAT) });
        await request(app).put(`/api/surat-keluar/${ID}`).send({ perihal: 'Koreksi', expectedUpdatedAt: DIMUAT }).expect(200);
        expect(mocks.keluar.update.mock.calls[0][1]).toEqual({ perihal: 'Koreksi', expectedUpdatedAt: new Date(DIMUAT) });
    });

    it('perubahan orang lain dijawab 409 dengan kode DATA_SUDAH_BERUBAH', async () => {
        mocks.masuk.update.mockRejectedValueOnce(new DataSudahBerubahError());
        const res = await request(app).put(`/api/surat-masuk/${ID}`).send({ perihal: 'Koreksi', expectedUpdatedAt: DIMUAT }).expect(409);
        expect(res.body).toMatchObject({
            code: 'DATA_SUDAH_BERUBAH',
            message: 'Data ini sudah diubah pengguna lain sejak Anda membukanya. Muat ulang halaman untuk melihat perubahan terbaru, lalu ulangi perubahan Anda.',
        });
    });

    it('menolak versi yang bukan tanggal', async () => {
        const res = await request(app).put(`/api/surat-keluar/${ID}`).send({ perihal: 'Koreksi', expectedUpdatedAt: 'kemarin' }).expect(400);
        expect(res.body.details).toEqual([expect.objectContaining({ field: 'expectedUpdatedAt' })]);
        expect(mocks.keluar.update).not.toHaveBeenCalled();
    });

    it('Ubah Metadata arsip: versi bukan metadata dan diteruskan terpisah', async () => {
        await request(app).put(`/api/arsip/${ID}`).send({ keterangan: 'Koreksi', expectedUpdatedAt: DIMUAT }).expect(200);
        expect(mocks.arsip.update).toHaveBeenCalledWith(ID, { keterangan: 'Koreksi' }, expect.objectContaining({ userId: 'user-tu' }),
            { expectedUpdatedAt: new Date(DIMUAT) });
        // Versi saja bukan perubahan metadata.
        await request(app).put(`/api/arsip/${ID}`).send({ expectedUpdatedAt: DIMUAT }).expect(400);
        // Klien rilis sebelumnya tanpa versi tetap dapat menyimpan.
        await request(app).put(`/api/arsip/${ID}`).send({ keterangan: 'Koreksi' }).expect(200);
        expect(mocks.arsip.update).toHaveBeenLastCalledWith(ID, { keterangan: 'Koreksi' }, expect.anything(), { expectedUpdatedAt: undefined });
    });
});
