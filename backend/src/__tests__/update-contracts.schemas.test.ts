import { describe, expect, it } from 'vitest';
import {
    createArsipTerjagaSchema,
    createArsipVitalSchema,
    createSuratMasukSchema,
    updateArsipSchema,
    updateArsipTerjagaSchema,
    updateArsipVitalSchema,
    updateSuratMasukSchema,
} from '../validators/schemas';

describe('partial update contracts', () => {
    it.each([
        ['surat masuk', updateSuratMasukSchema, { keterangan: 'Koreksi catatan' }],
        ['arsip vital', updateArsipVitalSchema, { alasanPenetapan: 'Koreksi alasan' }],
        ['arsip terjaga', updateArsipTerjagaSchema, { catatan: 'Koreksi catatan' }],
        ['arsip', updateArsipSchema, { keterangan: 'Koreksi catatan' }],
    ])('updates only supplied fields for %s', (_name, schema, patch) => {
        expect(schema.parse(patch)).toEqual(patch);
    });

    it('retains creation defaults for new records', () => {
        expect(createSuratMasukSchema.parse({
            unitKerjaId: 'ditjen', tanggalSurat: '2026-09-11', perihal: 'Rapat', dari: 'Sekretariat',
        }).status).toBe('belum_dibalas');
        const parent = { arsipId: '550e8400-e29b-41d4-a716-446655440001', unitKerjaId: 'ditjen' };
        expect(createArsipVitalSchema.parse({
            ...parent, kategoriVital: 'operasional', tingkatKekritisan: 'penting', alasanPenetapan: 'Dasar',
        }).statusProteksi).toBe('belum_diproteksi');
        expect(createArsipTerjagaSchema.parse({
            ...parent, kategoriTerjaga: 'pertanahan', dasarHukum: 'Dasar', uraianIsi: 'Uraian',
        })).toMatchObject({
            statusPelaporan: 'belum_dilaporkan', periodePelaporanHari: 365, statusKepatuhan: 'belum_dinilai',
        });
    });

    it('still accepts explicit status changes without inserting unrelated defaults', () => {
        expect(updateSuratMasukSchema.parse({ status: 'sudah_dibalas' })).toEqual({ status: 'sudah_dibalas' });
        expect(updateArsipVitalSchema.parse({ statusProteksi: 'terlindungi' })).toEqual({ statusProteksi: 'terlindungi' });
        expect(updateArsipTerjagaSchema.parse({ statusPelaporan: 'dilaporkan' })).toEqual({ statusPelaporan: 'dilaporkan' });
    });

    it('preserves actual editable archive metadata', () => {
        const metadata = {
            nomorBerkas: 'B-2026-001', uraianBerkas: 'Berkas pengadaan', nomorItem: '1',
            uraianItem: 'Dokumen awal', tingkatPerkembangan: 'Asli', tanggalArsip: '2026-09-11',
            kurunWaktu: '2026', jumlah: 2, mediaType: 'kertas', lokasiFc: 'A', lokasiLaci: '2',
            lokasiFolder: '3', personInCharge: 'Petugas', unitPengolah: 'Ditjen', keterangan: 'Koreksi',
        };
        expect(updateArsipSchema.parse(metadata)).toEqual(metadata);
    });

    it.each([
        {}, { catatan: 'Kolom lama' }, { deskripsi: 'Kolom lama' }, { retentionPeriod: 5 },
        { unitKerjaId: 'unit-lain' }, { sourceSuratId: '550e8400-e29b-41d4-a716-446655440002' },
        { storageLocationId: '550e8400-e29b-41d4-a716-446655440002' },
        { legalHold: false }, { disposalStatus: 'active' }, { extractedText: 'Teks pengganti' },
        { nomorBerkas: '' }, { tanggalArsip: '2026-02-31' }, { jumlah: -1 },
    ])('rejects an invalid or unsupported archive update %j', patch => {
        expect(updateArsipSchema.safeParse(patch).success).toBe(false);
    });
});
