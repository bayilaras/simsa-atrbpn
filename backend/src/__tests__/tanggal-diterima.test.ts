import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSuratMasukSchema, updateSuratMasukSchema } from '../validators/schemas';
import {
    PESAN_DITERIMA_SEBELUM_TANGGAL_SURAT, PESAN_DITERIMA_SETELAH_HARI_INI, pastikanTanggalDiterima,
} from '../services/tanggal-diterima';
import { parseImportDateDiterima } from '../services/import-tanggal';

// Tanggal diterima surat masuk: opsional, paling lambat hari ini (WIB), tidak sebelum tanggal surat.

const dasar = { unitKerjaId: 'sesditjen', tanggalSurat: '2026-11-10', perihal: 'Permohonan', dari: 'Kanwil' };
const galat = (hasil: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) =>
    hasil.success ? [] : hasil.error!.issues.map(isu => [isu.path.join('.'), isu.message]);

afterEach(() => { vi.useRealTimers(); });

describe('skema formulir surat masuk', () => {
    it('menerima tanggal diterima pada atau setelah tanggal surat, dan mengosongkan string kosong', () => {
        vi.useFakeTimers({ now: new Date('2026-11-15T03:00:00.000Z') });
        expect(createSuratMasukSchema.parse({ ...dasar, tanggalDiterima: '2026-11-10' }).tanggalDiterima).toBe('2026-11-10');
        expect(createSuratMasukSchema.parse({ ...dasar, tanggalDiterima: '' }).tanggalDiterima).toBeNull();
        expect(createSuratMasukSchema.parse(dasar).tanggalDiterima).toBeUndefined();
    });

    it('menolak tanggal diterima sebelum tanggal surat atau setelah hari ini (WIB) pada isiannya', () => {
        // 15 November 23.30 WIB: 16 November masih esok hari.
        vi.useFakeTimers({ now: new Date('2026-11-15T16:30:00.000Z') });
        expect(galat(createSuratMasukSchema.safeParse({ ...dasar, tanggalDiterima: '2026-11-09' })))
            .toEqual([['tanggalDiterima', PESAN_DITERIMA_SEBELUM_TANGGAL_SURAT]]);
        expect(galat(createSuratMasukSchema.safeParse({ ...dasar, tanggalDiterima: '2026-11-16' })))
            .toEqual([['tanggalDiterima', PESAN_DITERIMA_SETELAH_HARI_INI]]);
        expect(createSuratMasukSchema.safeParse({ ...dasar, tanggalDiterima: '2026-11-15' }).success).toBe(true);
    });

    it('suntingan memeriksa urutan bila kedua tanggal dikirim; satu tanggal saja diperiksa layanan', () => {
        vi.useFakeTimers({ now: new Date('2026-11-15T03:00:00.000Z') });
        expect(galat(updateSuratMasukSchema.safeParse({ tanggalSurat: '2026-11-12', tanggalDiterima: '2026-11-11' })))
            .toEqual([['tanggalDiterima', PESAN_DITERIMA_SEBELUM_TANGGAL_SURAT]]);
        expect(updateSuratMasukSchema.safeParse({ tanggalDiterima: '2026-11-11' }).success).toBe(true);
        expect(updateSuratMasukSchema.parse({ tanggalDiterima: '' }).tanggalDiterima).toBeNull();
    });
});

describe('pemeriksaan layanan dan impor', () => {
    it('pastikanTanggalDiterima memakai aturan yang sama', () => {
        vi.useFakeTimers({ now: new Date('2026-11-15T03:00:00.000Z') });
        expect(() => pastikanTanggalDiterima('2026-11-10', null)).not.toThrow();
        expect(() => pastikanTanggalDiterima(null, '2026-11-01')).not.toThrow();
        expect(() => pastikanTanggalDiterima('2026-11-10', '2026-11-09')).toThrow(PESAN_DITERIMA_SEBELUM_TANGGAL_SURAT);
        expect(() => pastikanTanggalDiterima('2026-11-10', '2026-11-16')).toThrow(PESAN_DITERIMA_SETELAH_HARI_INI);
    });

    it('sel impor dibaca dengan hari lebih dulu; pesan galatnya menyebut tanggal diterima', () => {
        expect(parseImportDateDiterima('12/11/2026')).toBe('2026-11-12');
        expect(parseImportDateDiterima('')).toBeNull();
        expect(parseImportDateDiterima('-')).toBeNull();
        expect(() => parseImportDateDiterima('kemarin')).toThrow(/^Tanggal diterima "kemarin" tidak dapat dibaca\./);
        expect(() => parseImportDateDiterima('31/02/2026')).toThrow(/^Tanggal diterima "31\/02\/2026" tidak ada di kalender\./);
    });
});
