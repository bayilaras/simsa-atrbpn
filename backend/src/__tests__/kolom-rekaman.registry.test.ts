import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { arsip, suratKeluar, suratMasuk } from '../db/schema';
import {
    ARSIP_KOLOM_DAFTAR,
    KOLOM_ARSIP,
    KOLOM_SURAT_KELUAR,
    KOLOM_SURAT_MASUK,
    proyeksiTanpaIsi,
} from '../services/access/kolom-rekaman';
import { ARSIP_KOLOM_DAFTAR as ARSIP_KOLOM_DAFTAR_LAYANAN } from '../services/arsip.service';

const kolomIsi = (registri: Record<string, string>) => Object.keys(registri).filter((key) => registri[key] === 'isi').sort();

describe('registri kolom rekaman', () => {
    it.each([
        ['arsip', arsip, KOLOM_ARSIP],
        ['surat_masuk', suratMasuk, KOLOM_SURAT_MASUK],
        ['surat_keluar', suratKeluar, KOLOM_SURAT_KELUAR],
    ] as const)('setiap kolom %s punya tepat satu kategori', (_nama, table, registri) => {
        expect(Object.keys(registri).sort()).toEqual(Object.keys(getTableColumns(table)).sort());
    });

    it('proyeksi daftar arsip memuat semua kolom selain isi', () => {
        expect(kolomIsi(KOLOM_ARSIP)).toEqual(['extractedText']);
        expect(Object.keys(ARSIP_KOLOM_DAFTAR).sort()).toEqual(
            Object.keys(getTableColumns(arsip)).filter((key) => key !== 'extractedText').sort(),
        );
        expect(ARSIP_KOLOM_DAFTAR_LAYANAN).toBe(ARSIP_KOLOM_DAFTAR);
    });

    it('kolom tanpa kategori tidak ikut proyeksi daftar', () => {
        const columns = { id: 'id', judul: 'judul', isi: 'isi', baru: 'baru' };
        expect(proyeksiTanpaIsi(columns, { id: 'kendali', judul: 'metadata', isi: 'isi' } as const)).toEqual({ id: 'id', judul: 'judul' });
    });

    it('kolom isi surat yang tercatat', () => {
        // Daftar surat (findAll) masih memilih semua kolom. Kolom isi baru pada
        // surat harus dikeluarkan dari proyeksi daftar sebelum dicatat di sini.
        expect(kolomIsi(KOLOM_SURAT_MASUK)).toEqual(['fileOriginalName', 'filePath', 'linkDokumen']);
        expect(kolomIsi(KOLOM_SURAT_KELUAR)).toEqual(['fileOriginalName', 'filePath', 'linkDokumen']);
    });
});
