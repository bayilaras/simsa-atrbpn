import { afterEach, describe, expect, it, vi } from 'vitest';
import api from './api';

describe('api validation errors', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('preserves structured validation details returned by the server', async () => {
        const details = {
            valid: false,
            errors: [{ code: 'missing_parent', message: 'Parent tidak ditemukan.' }],
            warnings: [],
            stats: { total: 1, active: 1, selectable: 1, roots: 0 },
            contentHash: 'a'.repeat(64),
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            json: vi.fn().mockResolvedValue({
                error: 'Draft aturan belum memenuhi syarat.',
                details,
            }),
        }));

        let thrown;
        try {
            await api.get('/api/validation-example');
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect(thrown.message).toBe('Draft aturan belum memenuhi syarat.');
        expect(thrown.status).toBe(400);
        expect(thrown.details).toEqual(details);
    });

    it.each([
        ['server baru', { error: 'Data yang dikirim belum valid. Periksa isian berikut.', message: 'Data yang dikirim belum valid. Periksa isian berikut.' }],
        ['server lama', { error: 'Validation failed' }],
    ])('pesan validasi umum (%s) menyebut rincian per isian', async (_label, body) => {
        const details = [{ field: 'judul', message: 'Judul wajib diisi' }, { field: 'kategori', message: 'Kategori maksimal 100 karakter' }];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: vi.fn().mockResolvedValue({ ...body, details }) }));
        await expect(api.post('/api/contoh', {})).rejects.toMatchObject({
            message: 'Data yang dikirim belum valid. Periksa isian berikut: Judul wajib diisi; Kategori maksimal 100 karakter',
            details,
        });
    });

    it('tanpa pesan server, status tidak ditampilkan sebagai kode HTTP', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: vi.fn().mockRejectedValue(new Error('bukan JSON')) }));
        await expect(api.get('/api/hilang')).rejects.toMatchObject({ message: 'Data atau alamat yang diminta tidak ditemukan.', status: 404 });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, json: vi.fn().mockResolvedValue({}) }));
        await expect(api.get('/api/lain')).rejects.toMatchObject({ message: 'Permintaan tidak dapat diproses. Periksa isian Anda, lalu coba lagi.' });
    });
});
