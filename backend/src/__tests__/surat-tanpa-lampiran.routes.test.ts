import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rute surat tidak mewajibkan link dokumen maupun berkas, dan galat validasi
// surat masuk membawa pesan per isian berbahasa Indonesia.

const mocks = vi.hoisted(() => ({
    masuk: { findById: vi.fn(), update: vi.fn(), create: vi.fn(), findArsipId: vi.fn() },
    keluar: { findById: vi.fn(), update: vi.fn(), create: vi.fn(), findArsipId: vi.fn() },
    check: vi.fn(),
}));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'user-bppt', email: 'b@example.test', name: 'B', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
        next();
    },
}));
vi.mock('../middlewares/role.middleware', () => ({ canWriteMiddleware: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../services/surat-masuk.service', () => ({ suratMasukService: mocks.masuk }));
vi.mock('../services/surat-keluar.service', () => ({ suratKeluarService: mocks.keluar }));
vi.mock('../services/record-access.service.js', () => {
    const normalize = (value?: string | null) => String(value ?? '').trim().toLowerCase() || 'biasa';
    return {
        allowedSecurityClassifications: () => ['biasa', 'terbatas'],
        isAllowedForClassification: (_user: unknown, value?: string | null) => ['biasa', 'terbatas'].includes(normalize(value)),
        normalizeSecurityClassification: normalize,
        recordAccessService: { check: mocks.check },
    };
});

const { default: masukRouter } = await import('../routes/surat-masuk.routes');
const { default: keluarRouter } = await import('../routes/surat-keluar.routes');
const app = express();
app.use(express.json());
app.use('/api/surat-masuk', masukRouter);
app.use('/api/surat-keluar', keluarRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ error: error.message }));

const ID = '550e8400-e29b-41d4-a716-446655440002';
const masuk = { id: ID, unitKerjaId: 'dir_bppt', isArchived: false, sifatSurat: 'biasa', filePath: null, linkDokumen: null, rangkaian: null };
const keluar = { id: ID, unitKerjaId: 'dir_bppt', isArchived: false, approvalStatus: 'draft', klasifikasiKeamanan: 'biasa', filePath: null, linkDokumen: null };
const isiMasuk = { unitKerjaId: 'dir_bppt', sifatSurat: 'biasa', tanggalSurat: '2026-09-01', perihal: 'Perihal uji', dari: 'Kanwil A', linkDokumen: '' };
const isiKeluar = { unitKerjaId: 'dir_bppt', tanggalSurat: '2026-09-01', perihal: 'Perihal uji', kepada: 'Direktur', linkDokumen: '' };

beforeEach(() => {
    for (const layanan of [mocks.masuk, mocks.keluar]) Object.values(layanan).forEach(mock => mock.mockReset());
    mocks.check.mockReset().mockResolvedValue({ exists: true, mutable: true, allowed: true });
    mocks.masuk.create.mockResolvedValue(masuk);
    mocks.masuk.update.mockResolvedValue(masuk);
    mocks.masuk.findById.mockResolvedValue(masuk);
    mocks.keluar.create.mockResolvedValue(keluar);
    mocks.keluar.update.mockResolvedValue(keluar);
    mocks.keluar.findById.mockResolvedValue(keluar);
});

describe('surat tanpa link dokumen dan tanpa berkas', () => {
    it('POST /api/surat-masuk menerimanya tanpa mendaftarkan lampiran', async () => {
        await request(app).post('/api/surat-masuk').send(isiMasuk).expect(201);
        const [data, , unggahan, lampiran] = mocks.masuk.create.mock.calls[0];
        expect(data).toMatchObject({ perihal: 'Perihal uji', filePath: null, fileOriginalName: null });
        expect(unggahan).toBeUndefined();
        expect(lampiran).toBeUndefined();
    });

    it('PUT /api/surat-masuk/:id menerimanya untuk surat yang belum punya lampiran', async () => {
        await request(app).put(`/api/surat-masuk/${ID}`).send({ dari: 'Kanwil B', linkDokumen: '' }).expect(200);
        expect(mocks.masuk.update).toHaveBeenCalledTimes(1);
        expect(mocks.masuk.update.mock.calls[0][1]).toMatchObject({ dari: 'Kanwil B' });
        expect(mocks.masuk.update.mock.calls[0][1].filePath).toBeUndefined();
    });

    it('POST /api/surat-keluar menerimanya tanpa mendaftarkan lampiran', async () => {
        await request(app).post('/api/surat-keluar').send(isiKeluar).expect(201);
        expect(mocks.keluar.create.mock.calls[0][0]).toMatchObject({ perihal: 'Perihal uji', filePath: null });
    });

    it('PUT /api/surat-keluar/:id menerimanya untuk draf yang belum punya lampiran', async () => {
        await request(app).put(`/api/surat-keluar/${ID}`).send({ perihal: 'Perihal baru', linkDokumen: '' }).expect(200);
        expect(mocks.keluar.update).toHaveBeenCalledTimes(1);
        expect(mocks.keluar.update.mock.calls[0][1]).toMatchObject({ perihal: 'Perihal baru' });
    });
});

describe('galat validasi surat masuk', () => {
    // Pesan pertama per isian, seperti yang ditampilkan formulir.
    const rincian = (res: request.Response) => Object.fromEntries(
        (res.body.details as Array<{ field: string; message: string }>).reverse().map(detail => [detail.field, detail.message]),
    );

    it('POST menyebut isian yang kosong atau salah dalam bahasa Indonesia', async () => {
        const res = await request(app).post('/api/surat-masuk').send({
            unitKerjaId: 'dir_bppt', sifatSurat: 'biasa', tanggalSurat: '01/09/2026', perihal: '',
            kepada: 'x'.repeat(256), linkDokumen: 'drive saya', tahun: 1900,
        }).expect(400);
        expect(rincian(res)).toEqual({
            tanggalSurat: 'Tanggal harus berformat TTTT-BB-HH, misalnya 2026-01-31',
            perihal: 'Perihal wajib diisi',
            dari: 'Pengirim wajib diisi',
            kepada: 'Penerima maksimal 255 karakter',
            linkDokumen: 'Link dokumen harus berupa alamat lengkap, misalnya https://contoh.go.id/berkas',
            tahun: 'Tahun harus antara 2000 dan 2100',
        });
        expect(mocks.masuk.create).not.toHaveBeenCalled();
    });

    it('POST tanpa tanggal surat menyebut tanggal wajib diisi', async () => {
        const { tanggalSurat: _tanpaTanggal, ...tanpaTanggal } = isiMasuk;
        const res = await request(app).post('/api/surat-masuk').send(tanpaTanggal).expect(400);
        expect(rincian(res)).toEqual({ tanggalSurat: 'Tanggal surat wajib diisi' });
    });

    it('PUT menyebut isian yang salah dalam bahasa Indonesia', async () => {
        const res = await request(app).put(`/api/surat-masuk/${ID}`)
            .send({ tanggalSurat: '2026-02-30', linkDokumen: 'bukan alamat', keterangan: 'x'.repeat(2001) }).expect(400);
        expect(rincian(res)).toEqual({
            tanggalSurat: 'Tanggal tidak valid',
            linkDokumen: 'Link dokumen harus berupa alamat lengkap, misalnya https://contoh.go.id/berkas',
            keterangan: 'Keterangan maksimal 2000 karakter',
        });
        expect(mocks.masuk.update).not.toHaveBeenCalled();
    });

    it('surat keluar memakai pesan link dokumen yang sama', async () => {
        const res = await request(app).post('/api/surat-keluar').send({ ...isiKeluar, linkDokumen: 'bukan alamat' }).expect(400);
        expect(rincian(res)).toEqual({
            linkDokumen: 'Link dokumen harus berupa alamat lengkap, misalnya https://contoh.go.id/berkas',
        });
    });
});
