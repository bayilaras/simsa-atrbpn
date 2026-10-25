import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createDistributionSchema, createSuratKeluarSchema, createSuratMasukSchema, disposisiRoutingSchema,
    processDistributionSchema, updateSuratMasukSchema, berkaskanSchema, gabungSchema, ajukanAksesSchema,
} from '../validators/schemas';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const UUID2 = '550e8400-e29b-41d4-a716-446655440001';
const suratMasukDasar = { unitKerjaId: 'sesditjen', tanggalSurat: '2026-09-12', perihal: 'Permohonan', dari: 'Kantah' };
const suratKeluarDasar = { unitKerjaId: 'dir_bppt', tanggalSurat: '2026-09-12', perihal: 'Balasan', kepada: 'Kantah' };

afterEach(() => vi.useRealTimers());

describe('skema registrasi surat masuk', () => {
    it('menerima routing disposisi dan referensi, juga sebagai JSON string multipart', () => {
        const routing = { targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep' }], instruksi: 'Mohon ditindaklanjuti', labelTambahan: ['Kabag Program dan Hukum'] };
        const parsed = createSuratMasukSchema.parse({ ...suratMasukDasar, disposisi: JSON.stringify(routing), referensi: JSON.stringify({ jenis: 'surat_keluar', id: UUID }) });
        expect(parsed.disposisi).toEqual({ ...routing, targets: [{ unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep', penanggungJawab: false }] });
        expect(parsed.referensi).toEqual({ jenis: 'surat_keluar', id: UUID });
    });

    it('tetap menerima label disposisi lama (string atau array)', () => {
        expect(createSuratMasukSchema.parse({ ...suratMasukDasar, disposisi: 'Ditjen' }).disposisi).toEqual(['Ditjen']);
        expect(createSuratMasukSchema.parse({ ...suratMasukDasar, disposisi: ['Dit. BPPT'] }).disposisi).toEqual(['Dit. BPPT']);
    });

    it('menolak target ganda dan dua penanggung jawab', () => {
        expect(disposisiRoutingSchema.safeParse({ targets: [{ unitKerjaId: 'dir_bppt' }, { unitKerjaId: 'dir_bppt' }] }).success).toBe(false);
        expect(disposisiRoutingSchema.safeParse({ targets: [
            { unitKerjaId: 'dir_bppt', penanggungJawab: true }, { unitKerjaId: 'dir_ptep', penanggungJawab: true },
        ] }).success).toBe(false);
        expect(disposisiRoutingSchema.safeParse({ targets: [] }).success).toBe(false);
    });

    it('menolak batas waktu sebelum hari ini (WIB)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-26T17:30:00Z')); // 27 Sep 2026 00.30 WIB
        expect(disposisiRoutingSchema.safeParse({ targets: [{ unitKerjaId: 'dir_bppt', batasWaktu: '2026-09-26' }] }).success).toBe(false);
        expect(disposisiRoutingSchema.safeParse({ targets: [{ unitKerjaId: 'dir_bppt', batasWaktu: '2026-09-27' }] }).success).toBe(true);
    });

    it('menormalkan baris baru instruksi routing (multipart tidak melewati sanitizer)', () => {
        expect(disposisiRoutingSchema.parse({ targets: [{ unitKerjaId: 'dir_bppt' }], instruksi: 'A\r\n\r\n\r\nB ' }).instruksi).toBe('A\n\nB');
    });

    it('update tidak lagi menerima status dan membawa alasan koreksi', () => {
        expect(updateSuratMasukSchema.parse({ status: 'sudah_dibalas' })).toEqual({});
        expect(updateSuratMasukSchema.parse({ perihal: 'Koreksi', alasan: '  Salah ketik perihal  ' })).toEqual({ perihal: 'Koreksi', alasan: 'Salah ketik perihal' });
        expect(updateSuratMasukSchema.safeParse({ alasan: 'pendek' }).success).toBe(false);
    });
});

describe('skema surat keluar', () => {
    it('inisiatif bersama induk ditolak', () => {
        expect(createSuratKeluarSchema.safeParse({ ...suratKeluarDasar, asalNaskah: 'inisiatif', balasanUntuk: UUID }).success).toBe(false);
        expect(createSuratKeluarSchema.safeParse({ ...suratKeluarDasar, asalNaskah: 'inisiatif',
            tindakLanjut: { jenis: 'surat_masuk', suratId: UUID, jenisRelasi: 'balasan' } }).success).toBe(false);
    });

    it('balasanUntuk lama dipetakan ke tindakLanjut balasan', () => {
        const parsed = createSuratKeluarSchema.parse({ ...suratKeluarDasar, balasanUntuk: UUID });
        expect(parsed.tindakLanjut).toEqual({ jenis: 'surat_masuk', suratId: UUID, jenisRelasi: 'balasan' });
        expect(parsed.asalNaskah).toBe('tindak_lanjut');
        expect(parsed).not.toHaveProperty('balasanUntuk');
    });

    it('ND penjelas memakai relasi menjelaskan ke surat keluar', () => {
        const parsed = createSuratKeluarSchema.parse({ ...suratKeluarDasar, tindakLanjut: { jenis: 'surat_keluar', suratId: UUID, jenisRelasi: 'menjelaskan' } });
        expect(parsed.asalNaskah).toBe('tindak_lanjut');
    });

    it('surat inisiatif murni diterima apa adanya', () => {
        expect(createSuratKeluarSchema.parse({ ...suratKeluarDasar, asalNaskah: 'inisiatif' })).toMatchObject({ asalNaskah: 'inisiatif', tindakLanjut: undefined });
    });

    it('tindakLanjut multipart (JSON string) diterima; tindak_lanjut tanpa induk dan induk berbeda ditolak', () => {
        const parsed = createSuratKeluarSchema.parse({ ...suratKeluarDasar,
            tindakLanjut: JSON.stringify({ jenis: 'surat_masuk', suratId: UUID, jenisRelasi: 'tindak_lanjut' }) });
        expect(parsed.tindakLanjut).toEqual({ jenis: 'surat_masuk', suratId: UUID, jenisRelasi: 'tindak_lanjut' });
        expect(createSuratKeluarSchema.safeParse({ ...suratKeluarDasar, asalNaskah: 'tindak_lanjut' }).success).toBe(false);
        expect(createSuratKeluarSchema.safeParse({ ...suratKeluarDasar, balasanUntuk: UUID2,
            tindakLanjut: { jenis: 'surat_masuk', suratId: UUID, jenisRelasi: 'balasan' } }).success).toBe(false);
    });
});

describe('skema distribusi', () => {
    it('bentuk tunggal lama dinormalkan menjadi satu target', () => {
        expect(createDistributionSchema.parse({ suratMasukId: UUID, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', instruction: 'Segera' }))
            .toEqual({ suratMasukId: UUID, sourceUnitId: 'sesditjen', instruksi: 'Segera', ccUnits: undefined, bentuk: 'tunggal',
                targets: [{ unitKerjaId: 'dir_bppt', batasWaktu: null, penanggungJawab: false }] });
    });

    it('bentuk jamak memakai targets dan menolak isian ganda', () => {
        expect(createDistributionSchema.parse({ suratMasukId: UUID, sourceUnitId: 'sesditjen', targets: [{ unitKerjaId: 'dir_bppt' }] }).bentuk).toBe('jamak');
        expect(createDistributionSchema.safeParse({ suratMasukId: UUID, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', targets: [{ unitKerjaId: 'dir_ptep' }] }).success).toBe(false);
    });

    it('penyelesaian: surat keluar ATAU catatan ≥10 karakter', () => {
        expect(processDistributionSchema.safeParse({ penyelesaianSuratKeluarId: UUID }).success).toBe(true);
        expect(processDistributionSchema.safeParse({ catatanPenyelesaian: 'Sudah dikoordinasikan' }).success).toBe(true);
        expect(processDistributionSchema.safeParse({ catatanPenyelesaian: 'ok' }).success).toBe(false);
        expect(processDistributionSchema.safeParse({}).success).toBe(false);
    });
});

describe('skema aksi rangkaian', () => {
    it('berkaskan wajib konfirmasi dua langkah', () => {
        expect(berkaskanSchema.safeParse({ unitPengolahId: 'dir_bppt', klasifikasiItemId: 5, konfirmasi: true }).success).toBe(true);
        expect(berkaskanSchema.safeParse({ unitPengolahId: 'dir_bppt', klasifikasiItemId: 5, konfirmasi: false }).success).toBe(false);
    });

    it('gabung wajib alasan ≥10 dan ajukan akses wajib tujuan ≥20', () => {
        expect(gabungSchema.safeParse({ sumberId: UUID2, alasan: 'pendek' }).success).toBe(false);
        expect(ajukanAksesSchema.parse({ purpose: 'Menindaklanjuti disposisi dari TU' })).toEqual({ purpose: 'Menindaklanjuti disposisi dari TU', accessMode: 'view' });
    });
});
