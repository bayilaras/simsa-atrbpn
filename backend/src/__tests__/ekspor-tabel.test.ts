import { describe, expect, it } from 'vitest';
import {
    excelDariTabel, pdfDariTabel, pilihanSaringan, SaringanEksporTidakSah, selAman, tanggalSaringan, type TabelEkspor,
} from '../services/export-tabel';
import { hariTerlambat } from '../services/export-peminjaman';
import { barisTersamar, lewatBatasWaktu } from '../services/export-disposisi';
import { ringkasanPerubahan } from '../services/export-audit-log';
import { loadExcelJS } from '../utils/lazy-libraries';

const tabel = (baris: TabelEkspor['baris']): TabelEkspor => ({
    lembar: 'Uji', judul: 'DAFTAR UJI', keterangan: ['Unit Uji'], kolomLentur: 1, total: `Total: ${baris.length} baris`,
    kolom: [{ judul: 'No', lebarExcel: 6, lebarPdf: 30 }, { judul: 'Isi', lebarExcel: 40, lebarPdf: 200, rataKiri: true }],
    baris,
});

describe('daftar ekspor sederhana', () => {
    it.each(['=1+1', '+SUM(A1:A2)', '-2+3', '@SUM(1)', '=HYPERLINK("http://contoh.test","klik")'])(
        'isian %s ditulis sebagai teks, bukan rumus', async (isi) => {
            const ExcelJS = await loadExcelJS();
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(await excelDariTabel(tabel([[1, isi]])) as never);
            const sel = workbook.worksheets[0].getCell(5, 2);
            expect(sel.type).toBe(ExcelJS.ValueType.String);
            expect(sel.value).toBe(isi);
            expect(sel.formula).toBeUndefined();
        });

    it('sel hanya menerima teks atau angka; objek rumus tidak pernah diteruskan', () => {
        expect(selAman({ formula: '1+1' })).toBe('[object Object]');
        expect(selAman(null)).toBe('');
        expect(selAman(undefined)).toBe('');
        expect(selAman(Number.NaN)).toBe('');
        expect(selAman(12)).toBe(12);
        expect(selAman('teks')).toBe('teks');
    });

    it('PDF banyak baris tetap satu berkas utuh', async () => {
        const baris = Array.from({ length: 120 }, (_, i) => [i + 1, `Baris ${i + 1} dengan uraian yang cukup panjang untuk dibungkus dalam sel`]);
        const buffer = await pdfDariTabel(tabel(baris));
        expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    });

    it('penyaring pilihan dan tanggal: kosong berarti tidak disaring, nilai lain ditolak', () => {
        expect(pilihanSaringan(undefined, ['a', 'b'] as const, 'uji')).toBeUndefined();
        expect(pilihanSaringan('', ['a', 'b'] as const, 'uji')).toBeUndefined();
        expect(pilihanSaringan('b', ['a', 'b'] as const, 'uji')).toBe('b');
        expect(() => pilihanSaringan('c', ['a', 'b'] as const, 'uji')).toThrow(SaringanEksporTidakSah);
        expect(() => pilihanSaringan(['a'], ['a', 'b'] as const, 'uji')).toThrow(SaringanEksporTidakSah);
        expect(tanggalSaringan('2026-02-28', 'Tanggal')).toBe('2026-02-28');
        expect(tanggalSaringan('', 'Tanggal')).toBeUndefined();
        expect(() => tanggalSaringan('2026-02-30', 'Tanggal')).toThrow(SaringanEksporTidakSah);
        expect(() => tanggalSaringan('28/02/2026', 'Tanggal')).toThrow(SaringanEksporTidakSah);
    });
});

describe('aturan kolom rekap', () => {
    it('hari terlambat: sampai hari ini bila belum kembali, sampai tanggal kembali bila sudah', () => {
        expect(hariTerlambat({ dueDate: '2026-09-10', returnDate: null, status: 'overdue' }, '2026-09-20')).toBe(10);
        expect(hariTerlambat({ dueDate: '2026-09-30', returnDate: null, status: 'borrowed' }, '2026-09-20')).toBe(0);
        expect(hariTerlambat({ dueDate: '2026-09-20', returnDate: null, status: 'borrowed' }, '2026-09-20')).toBe(0);
        expect(hariTerlambat({ dueDate: '2026-08-10', returnDate: '2026-08-13', status: 'returned' }, '2026-09-20')).toBe(3);
        expect(hariTerlambat({ dueDate: '2026-08-10', returnDate: '2026-08-09', status: 'returned' }, '2026-09-20')).toBe(0);
    });

    it('lewat batas disposisi: terbuka dan batasnya sebelum hari ini', () => {
        expect(lewatBatasWaktu({ batasWaktu: '2026-09-19', status: 'sent' }, '2026-09-20')).toBe(true);
        expect(lewatBatasWaktu({ batasWaktu: '2026-09-19', status: 'received' }, '2026-09-20')).toBe(true);
        expect(lewatBatasWaktu({ batasWaktu: '2026-09-20', status: 'sent' }, '2026-09-20')).toBe(false);
        expect(lewatBatasWaktu({ batasWaktu: '2026-09-01', status: 'processed' }, '2026-09-20')).toBe(false);
        expect(lewatBatasWaktu({ batasWaktu: '2026-09-01', status: 'rejected' }, '2026-09-20')).toBe(false);
        expect(lewatBatasWaktu({ batasWaktu: null, status: 'sent' }, '2026-09-20')).toBe(false);
    });

    it('baris Kotak Masuk tersamar kecuali ditandai terbaca', () => {
        expect(barisTersamar({ status: 'sent', masked: false }, 'inbox')).toBe(false);
        expect(barisTersamar({ status: 'sent', masked: true }, 'inbox')).toBe(true);
        expect(barisTersamar({ status: 'sent' }, 'inbox')).toBe(true);
        expect(barisTersamar({ status: 'sent' }, 'outbox')).toBe(false);
        expect(barisTersamar({ status: 'sent', masked: true }, 'outbox')).toBe(true);
    });

    it('ringkasan audit hanya memuat nama isian', () => {
        expect(ringkasanPerubahan(null)).toBe('');
        expect(ringkasanPerubahan('teks')).toBe('');
        expect(ringkasanPerubahan({ before: { a: 'NILAI-A' }, after: { a: 'NILAI-B', b: 'NILAI-C' } })).toBe('Isian: a, b');
        expect(ringkasanPerubahan({ fields: ['x', 7, 'y'], before: { z: 1 } })).toBe('Isian: x, y');
        expect(ringkasanPerubahan({ via: 'peserta', rangkaianId: 'r-1' })).toBe('');
        expect(ringkasanPerubahan({ source: 'isi surat yang panjang sekali', format: 'pdf' })).toBe('Format: pdf');
        const banyak = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`isian${i + 1}`, 'x']));
        expect(ringkasanPerubahan({ after: banyak })).toBe(
            `Isian: ${Array.from({ length: 12 }, (_, i) => `isian${i + 1}`).join(', ')}, dan 3 lainnya`,
        );
    });
});
