import { describe, expect, it } from 'vitest';
import {
    createSuratKeluarSchema,
    createSuratMasukSchema,
    updateSuratKeluarSchema,
} from '../validators/schemas';
import {
    sanitizeSuratKeluarWithLinks,
    sanitizeSuratMasukWithLinks,
    sanitizeSuratRecord,
} from '../utils/sanitize-surat-response';

const baseSuratKeluar = {
    unitKerjaId: 'ditjen',
    tahun: 2026,
    naskahDinas: 'Surat Dinas',
    nomorSurat: '1/AT.01/VIII/2026',
    tanggalSurat: '2026-08-25',
    perihal: 'Pengadaan tanah',
    kepada: 'Kepala Kantor Pertanahan',
};

const baseSuratMasuk = {
    unitKerjaId: 'ditjen',
    nomorSurat: '2/AT.01/VIII/2026',
    tanggalSurat: '2026-08-25',
    perihal: 'Permohonan data',
    dari: 'Kantor Pertanahan',
};

describe('surat payload and private Blob policy', () => {
    it('accepts the actual surat_keluar database fields', () => {
        const result = createSuratKeluarSchema.safeParse({
            ...baseSuratKeluar,
            klasifikasiFasilitatifKode: 'KA.01',
            balasanUntuk: '550e8400-e29b-41d4-a716-446655440000',
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.kepada).toBe(baseSuratKeluar.kepada);
            expect(result.data).not.toHaveProperty('tujuan');
        }
    });

    it('rejects the obsolete tujuan payload when kepada is missing', () => {
        const { kepada: _kepada, ...withoutKepada } = baseSuratKeluar;
        expect(createSuratKeluarSchema.safeParse({
            ...withoutKepada,
            tujuan: 'Field lama',
        }).success).toBe(false);
    });

    it('accepts only the matching private Vercel Blob prefix', () => {
        expect(createSuratKeluarSchema.safeParse({
            ...baseSuratKeluar,
            filePath: 'https://store.private.blob.vercel-storage.com/surat-keluar/document-abc.pdf',
        }).success).toBe(true);
        expect(createSuratMasukSchema.safeParse({
            ...baseSuratMasuk,
            filePath: 'https://store.private.blob.vercel-storage.com/surat-masuk/document-abc.pdf',
        }).success).toBe(true);
    });

    it.each([
        'https://store.blob.vercel-storage.com/surat-keluar/public.pdf',
        'https://store.private.blob.vercel-storage.com/surat-masuk/wrong-prefix.pdf',
        'https://attacker.example/surat-keluar/document.pdf',
        'https://store.private.blob.vercel-storage.com/surat-keluar/%2e%2e/surat-masuk/document.pdf',
        '/api/files/surat_keluar/550e8400-e29b-41d4-a716-446655440000',
        'blob:https://store.private.blob.vercel-storage.com/surat-keluar/document.pdf',
    ])('rejects an untrusted outgoing locator: %s', (filePath) => {
        expect(updateSuratKeluarSchema.safeParse({ filePath }).success).toBe(false);
    });
});

describe('surat response sanitization', () => {
    it('replaces the raw locator while retaining an explicit file indicator', () => {
        const result = sanitizeSuratRecord({
            id: 'sk-1',
            filePath: 'blob:https://store.private.blob.vercel-storage.com/surat-keluar/secret.pdf',
            fileOriginalName: 'secret.pdf',
        }, 'surat_keluar');

        expect(result).toMatchObject({
            id: 'sk-1',
            hasFile: true,
            filePath: '/api/files/surat_keluar/sk-1',
            fileOriginalName: 'secret.pdf',
        });
        expect(JSON.stringify(result)).not.toContain('blob.vercel-storage.com');
    });

    it('sanitizes outgoing replies nested under an incoming letter', () => {
        const result = sanitizeSuratMasukWithLinks({
            id: 'sm-1',
            filePath: 'raw-incoming-locator',
            balasan: [{ id: 'sk-1', filePath: 'raw-outgoing-locator' }],
        });

        expect(result.filePath).toBe('/api/files/surat_masuk/sm-1');
        expect(result.balasan[0].filePath).toBe('/api/files/surat_keluar/sk-1');
        expect(JSON.stringify(result)).not.toContain('raw-');
    });

    it('sanitizes the incoming source nested under an outgoing letter', () => {
        const result = sanitizeSuratKeluarWithLinks({
            id: 'sk-1',
            filePath: 'raw-outgoing-locator',
            sourceSuratMasuk: { id: 'sm-1', filePath: 'raw-incoming-locator' },
        });

        expect(result.filePath).toBe('/api/files/surat_keluar/sk-1');
        expect(result.sourceSuratMasuk.filePath).toBe('/api/files/surat_masuk/sm-1');
        expect(JSON.stringify(result)).not.toContain('raw-');
    });
});
