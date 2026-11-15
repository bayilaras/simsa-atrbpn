import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError } from '../utils/errors.js';
import { publicErrorResponse, publicErrorStatus } from '../utils/public-error.js';

// Kontrak permintaan untuk No. Agenda/No. Urut pada formulir tambah dan
// tahun surat yang mengikuti tanggal saat diubah.
const ID = '550e8400-e29b-41d4-a716-446655440000';
const mocks = vi.hoisted(() => ({
    masuk: { create: vi.fn(), update: vi.fn(), findById: vi.fn(), getNextNumber: vi.fn(), findArsipId: vi.fn(async () => null) },
    keluar: { create: vi.fn(), update: vi.fn(), findById: vi.fn(), getNextNumber: vi.fn(), findArsipId: vi.fn(async () => null) },
}));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-tu', email: 'tu@example.test', name: 'TU', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
        next();
    },
}));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: mocks.masuk }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: mocks.keluar }));
vi.mock('../services/record-access.service.js', () => ({
    allowedSecurityClassifications: () => ['biasa', 'terbatas'],
    isAllowedForClassification: () => true,
    normalizeSecurityClassification: (value: string | null) => (value ?? 'biasa').toLowerCase(),
    recordAccessService: { check: vi.fn(async () => ({ exists: true, allowed: true, mutable: true, unitKerjaId: 'dir_bppt', classification: 'biasa' })) },
}));
vi.mock('../config/database', () => ({ db: {} }));

const { default: suratMasukRouter } = await import('../routes/surat-masuk.routes');
const { default: suratKeluarRouter } = await import('../routes/surat-keluar.routes');
const app = express();
app.use(express.json());
app.use('/api/surat-masuk', suratMasukRouter);
app.use('/api/surat-keluar', suratKeluarRouter);
// Same treatment of AppError as the global handler in app.ts.
app.use((error: unknown, _req: any, res: any, _next: any) => res.status(publicErrorStatus(error)).json(publicErrorResponse(error)));

const suratMasukDasar = { unitKerjaId: 'dir_bppt', jenisSurat: 'Nota Dinas', sifatSurat: 'biasa', tanggalSurat: '2026-03-02', perihal: 'Permohonan data', dari: 'Kanwil A' };
const suratKeluarDasar = { unitKerjaId: 'dir_bppt', naskahDinas: 'Nota Dinas', numberingMode: 'auto', tanggalSurat: '2026-03-02', perihal: 'Undangan', kepada: 'Direktur' };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.masuk.create.mockResolvedValue({ id: ID, noUrut: 345 });
    mocks.masuk.findById.mockResolvedValue({ id: ID, unitKerjaId: 'dir_bppt', isArchived: false, sifatSurat: 'biasa', filePath: null });
    mocks.masuk.update.mockResolvedValue({ id: ID });
    mocks.keluar.create.mockResolvedValue({ id: ID, noUrut: 120 });
    mocks.keluar.findById.mockResolvedValue({ id: ID, unitKerjaId: 'dir_bppt', isArchived: false, approvalStatus: 'draft', klasifikasiKeamanan: 'biasa', filePath: null });
    mocks.keluar.update.mockResolvedValue({ id: ID });
});

describe('No. Agenda dan No. Urut pada formulir tambah', () => {
    it('meneruskan No. Agenda yang diketik ke pembuatan surat masuk', async () => {
        await request(app).post('/api/surat-masuk').send({ ...suratMasukDasar, noUrut: '345' }).expect(201);
        expect(mocks.masuk.create).toHaveBeenCalledWith(expect.objectContaining({ noUrut: 345 }), expect.anything(), undefined, undefined);
    });

    it('meneruskan No. Urut yang diketik ke pembuatan surat keluar', async () => {
        await request(app).post('/api/surat-keluar').send({ ...suratKeluarDasar, noUrut: 120 }).expect(201);
        expect(mocks.keluar.create).toHaveBeenCalledWith(expect.objectContaining({ noUrut: 120 }), expect.anything(), undefined, undefined);
    });

    it.each([[0], [1_000_000], ['12a'], [2.5]])('menolak No. Agenda %j dengan pesan isian', async noUrut => {
        const res = await request(app).post('/api/surat-masuk').send({ ...suratMasukDasar, noUrut }).expect(400);
        expect(res.body.details).toEqual([expect.objectContaining({ field: 'noUrut', message: expect.stringMatching(/^No\. Agenda harus/) })]);
        expect(mocks.masuk.create).not.toHaveBeenCalled();
    });

    it('jawaban 409 dari layanan diteruskan dengan pesannya', async () => {
        mocks.masuk.create.mockRejectedValueOnce(new ConflictError('No. Agenda 345 tahun 2026 sudah dipakai surat lain di unit ini.'));
        const res = await request(app).post('/api/surat-masuk').send({ ...suratMasukDasar, noUrut: 345 }).expect(409);
        expect(res.body).toMatchObject({ code: 'CONFLICT', message: 'No. Agenda 345 tahun 2026 sudah dipakai surat lain di unit ini.' });
    });

    it('pratinjau nomor memakai nomor yang diketik', async () => {
        mocks.keluar.getNextNumber.mockResolvedValue({ nextNumber: 4, nomorSurat: '120/Nota Dinas/03/2026' });
        await request(app).get('/api/surat-keluar/next-number').query({ tanggalSurat: '2026-03-02', naskahDinas: 'Nota Dinas', noUrut: '120' }).expect(200);
        expect(mocks.keluar.getNextNumber).toHaveBeenCalledWith('dir_bppt', expect.objectContaining({ noUrut: 120 }));
    });
});

describe('ubah surat: tahun dan nomor urut ditentukan server dari tanggal surat', () => {
    it('surat masuk: tahun dan No. Agenda dari klien dibuang', async () => {
        await request(app).put(`/api/surat-masuk/${ID}`).send({ perihal: 'Koreksi', tanggalSurat: '2025-12-30', tahun: 2020, noUrut: 9 }).expect(200);
        expect(mocks.masuk.update.mock.calls[0][1]).toEqual({ perihal: 'Koreksi', tanggalSurat: '2025-12-30' });
    });

    it('surat keluar: tahun dari klien dibuang', async () => {
        await request(app).put(`/api/surat-keluar/${ID}`).send({ perihal: 'Koreksi', tanggalSurat: '2025-12-30', tahun: 2020 }).expect(200);
        expect(mocks.keluar.update.mock.calls[0][1]).toEqual({ perihal: 'Koreksi', tanggalSurat: '2025-12-30' });
    });
});
