import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ValidationError } from '../utils/errors.js';
import { publicErrorResponse, publicErrorStatus } from '../utils/public-error.js';

const mocks = vi.hoisted(() => ({
    update: vi.fn(), addSuratMasuk: vi.fn(), addSuratKeluar: vi.fn(),
    create: vi.fn(), delete: vi.fn(), removeSuratMasuk: vi.fn(), removeSuratKeluar: vi.fn(),
}));

vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { id: 'synthetic-user', email: 'qa@example.test', role: 'admin_unit', unitKerjaId: 'unit-a' };
        next();
    },
}));
vi.mock('../middlewares/rate-limiter.middleware', () => ({
    sensitiveLimiter: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../services/dosir.service', () => ({
    dosirService: {
        update: mocks.update, addSuratMasuk: mocks.addSuratMasuk, addSuratKeluar: mocks.addSuratKeluar,
        create: mocks.create, delete: mocks.delete, removeSuratMasuk: mocks.removeSuratMasuk, removeSuratKeluar: mocks.removeSuratKeluar,
    },
}));
vi.mock('../services/record-access.service', () => ({ allowedSecurityClassifications: () => ['biasa'] }));
vi.mock('../utils/logger', () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }));

import dosirRouter from '../routes/dosir.routes';

const app = express();
app.use(express.json());
app.use('/api/dosir', dosirRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(publicErrorStatus(error)).json(publicErrorResponse(error, 'synthetic-dosir-request'));
});

const dosirId = 'f3ab2f27-6759-4f0b-a995-bc874dad9828';
const invalidRangeMessage = 'Tanggal selesai tidak boleh sebelum tanggal mulai.';

beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
});

describe('dosir update request and error boundaries', () => {
    it('rejects an inverted pair in the request before calling the service', async () => {
        const response = await request(app).put(`/api/dosir/${dosirId}`).send({
            tanggalMulai: '2026-09-14', tanggalSelesai: '2026-09-13',
        });
        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({ success: false, details: [{ field: 'tanggalSelesai' }] });
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('returns 400 when the service rejects a partial edit against the stored date', async () => {
        mocks.update.mockRejectedValue(new ValidationError(invalidRangeMessage));
        const response = await request(app).put(`/api/dosir/${dosirId}`).send({ tanggalSelesai: '2026-09-13' });
        expect(mocks.update).toHaveBeenCalledWith(
            dosirId, { tanggalSelesai: '2026-09-13' }, 'unit-a', expect.objectContaining({ userId: 'synthetic-user' }),
        );
        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({
            success: false, message: invalidRangeMessage, code: 'VALIDATION_ERROR', requestId: 'synthetic-dosir-request',
        });
    });

    it('keeps unexpected failures at 500 without exposing internal details', async () => {
        const privateMarker = 'SYNTHETIC_PRIVATE_QUERY_AND_SIGNED_URL';
        mocks.update.mockRejectedValue(new Error(privateMarker));
        const response = await request(app).put(`/api/dosir/${dosirId}`).send({ judul: 'Revisi sintetis' });
        expect(mocks.update).toHaveBeenCalledOnce();
        expect(response.status).toBe(500);
        expect(response.body.success).toBe(false);
        expect(response.text).not.toContain(privateMarker);
        expect(response.body).not.toHaveProperty('stack');
    });

    it('keeps an inaccessible record at 404 and ignores a caller-supplied foreign unit', async () => {
        mocks.update.mockResolvedValue(undefined);
        const response = await request(app).put(`/api/dosir/${dosirId}?unitKerjaId=unit-b`).send({ judul: 'Revisi sintetis' });
        expect(mocks.update).toHaveBeenCalledWith(
            dosirId, { judul: 'Revisi sintetis' }, 'unit-a', expect.objectContaining({ userId: 'synthetic-user' }),
        );
        expect(response.status).toBe(404);
        expect(response.body).toEqual({ success: false, error: 'Dosir tidak ditemukan atau sudah dihapus.' });
    });
});

describe('dosir surat link responses', () => {
    const suratId = '0b6f0c55-3f0e-4f43-9d39-6c1f0e7f2a10';

    it('links a surat keluar within the caller unit scope', async () => {
        mocks.addSuratKeluar.mockResolvedValue({ dosirId, suratKeluarId: suratId });
        const response = await request(app).post(`/api/dosir/${dosirId}/surat`).send({ type: 'keluar', suratId, notes: 'Catatan sintetis' });
        expect(mocks.addSuratKeluar).toHaveBeenCalledWith(
            dosirId, suratId, 'Catatan sintetis', 'unit-a', ['biasa'], expect.objectContaining({ userId: 'synthetic-user' }),
        );
        expect(mocks.addSuratMasuk).not.toHaveBeenCalled();
        expect(response.status).toBe(201);
    });

    it('returns an Indonesian message when the dosir or surat is outside the scope', async () => {
        mocks.addSuratMasuk.mockResolvedValue(null);
        const response = await request(app).post(`/api/dosir/${dosirId}/surat`).send({ type: 'masuk', suratId });
        expect(response.status).toBe(404);
        expect(response.body).toEqual({
            success: false, error: 'Dosir atau surat tidak ditemukan, atau surat bukan milik unit kerja dosir ini.',
        });
    });

    it('returns an Indonesian conflict message for a surat that is already linked', async () => {
        mocks.addSuratMasuk.mockRejectedValue(Object.assign(new Error('wrapped'), { cause: { code: '23505' } }));
        const response = await request(app).post(`/api/dosir/${dosirId}/surat`).send({ type: 'masuk', suratId });
        expect(response.status).toBe(409);
        expect(response.body).toEqual({ success: false, error: 'Surat ini sudah ada di dosir.' });
    });

    it('returns an Indonesian message without internal details on unexpected failures', async () => {
        const privateMarker = 'SYNTHETIC_PRIVATE_LINK_FAILURE';
        mocks.addSuratMasuk.mockRejectedValue(new Error(privateMarker));
        const response = await request(app).post(`/api/dosir/${dosirId}/surat`).send({ type: 'masuk', suratId });
        expect(response.status).toBe(500);
        expect(response.body).toEqual({ success: false, error: 'Surat belum dapat ditambahkan ke dosir. Silakan coba lagi.' });
        expect(response.text).not.toContain(privateMarker);
    });
});

describe('pembuatan dosir', () => {
    it('membiarkan layanan membuat kode di bawah kunci unit', async () => {
        mocks.create.mockResolvedValue({ id: dosirId, kode: 'unit-a-2026-001' });
        await request(app).post('/api/dosir').send({ judul: 'Perkara sintetis', kode: 'kode-pilihan-klien' }).expect(201);
        expect(mocks.create).toHaveBeenCalledWith(
            expect.objectContaining({ unitKerjaId: 'unit-a', judul: 'Perkara sintetis', kode: undefined }),
            expect.objectContaining({ userId: 'synthetic-user' }),
        );
    });

    it('menjawab 409 dengan pesan berbahasa Indonesia bila kode sudah pernah dipakai di unit', async () => {
        const pesan = 'Kode dosir unit-a-2026-002 sudah pernah dipakai di unit kerja ini. Silakan coba lagi.';
        mocks.create.mockRejectedValue(new ConflictError(pesan));
        const response = await request(app).post('/api/dosir').send({ judul: 'Perkara sintetis' });
        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({ success: false, message: pesan, code: 'CONFLICT' });
    });

    it('kegagalan lain dijawab 500 dengan pesan berbahasa Indonesia tanpa rincian internal', async () => {
        const privateMarker = 'SYNTHETIC_PRIVATE_CREATE_FAILURE';
        mocks.create.mockRejectedValue(new Error(privateMarker));
        const response = await request(app).post('/api/dosir').send({ judul: 'Perkara sintetis' });
        expect(response.status).toBe(500);
        expect(response.body).toEqual({ success: false, error: 'Dosir belum tersimpan. Silakan coba lagi.' });
        expect(response.text).not.toContain(privateMarker);
    });
});

describe('hapus dosir dan lepas surat', () => {
    const suratId = '0b6f0c55-3f0e-4f43-9d39-6c1f0e7f2a10';

    it('hapus dosir: pesan berbahasa Indonesia untuk tidak ditemukan dan untuk kegagalan', async () => {
        mocks.delete.mockResolvedValueOnce(null);
        const hilang = await request(app).delete(`/api/dosir/${dosirId}`);
        expect(hilang.status).toBe(404);
        expect(hilang.body).toEqual({ success: false, error: 'Dosir tidak ditemukan atau sudah dihapus.' });

        mocks.delete.mockRejectedValueOnce(new Error('SYNTHETIC_PRIVATE_DELETE_FAILURE'));
        const gagal = await request(app).delete(`/api/dosir/${dosirId}`);
        expect(gagal.status).toBe(500);
        expect(gagal.body).toEqual({ success: false, error: 'Dosir belum dapat dihapus. Silakan coba lagi.' });
        expect(gagal.text).not.toContain('SYNTHETIC_PRIVATE_DELETE_FAILURE');
    });

    it('lepas surat: pesan berbahasa Indonesia untuk jenis salah, tidak tertaut, dan kegagalan', async () => {
        const jenisSalah = await request(app).delete(`/api/dosir/${dosirId}/surat/lainnya/${suratId}`);
        expect(jenisSalah.status).toBe(400);
        expect(jenisSalah.body).toEqual({ success: false, error: 'Jenis surat harus masuk atau keluar.' });

        mocks.removeSuratKeluar.mockResolvedValueOnce(null);
        const tidakTertaut = await request(app).delete(`/api/dosir/${dosirId}/surat/keluar/${suratId}`);
        expect(tidakTertaut.status).toBe(404);
        expect(tidakTertaut.body).toEqual({ success: false, error: 'Surat tidak ditemukan pada dosir ini.' });

        mocks.removeSuratMasuk.mockRejectedValueOnce(new Error('SYNTHETIC_PRIVATE_UNLINK_FAILURE'));
        const gagal = await request(app).delete(`/api/dosir/${dosirId}/surat/masuk/${suratId}`);
        expect(gagal.status).toBe(500);
        expect(gagal.body).toEqual({ success: false, error: 'Surat belum dapat dilepas dari dosir. Silakan coba lagi.' });
        expect(gagal.text).not.toContain('SYNTHETIC_PRIVATE_UNLINK_FAILURE');
    });
});
