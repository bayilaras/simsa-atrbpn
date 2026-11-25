import { EXPORT_ROW_LIMIT, requireCompleteExport } from './export-completeness.js';
import { namaUnitPengolah } from './export-unit-pengolah.js';
import { keteranganPeriodeLaporan } from './laporan-periode';
import { reportService } from './report.service';
import { jakartaDate, selisihHariKalender } from '../utils/jakarta-date.js';
import type { SelTabel, TabelEkspor } from './export-tabel.js';

/**
 * Rekap peminjaman arsip dari Laporan > Peminjaman. Barisnya diambil lewat
 * reportService.getLendingReport, kueri yang sama dengan tabel di layar, jadi
 * unit, kelas keamanan arsip, status, dan rentang tanggal pinjamnya sama.
 */
export const STATUS_PEMINJAMAN = ['all', 'borrowed', 'returned', 'overdue'] as const;
export type StatusPeminjaman = typeof STATUS_PEMINJAMAN[number];

export interface SaringanEksporPeminjaman {
    unitKerjaId: string;
    status: StatusPeminjaman;
    tanggalDari?: string;
    tanggalSampai?: string;
    securityClassifications: string[];
}

// Sama dengan label status di tab Peminjaman.
const LABEL_STATUS: Record<string, string> = {
    all: 'Semua',
    borrowed: 'Dipinjam',
    returned: 'Dikembalikan',
    overdue: 'Terlambat',
};

export interface BarisPeminjaman {
    lendingType: string;
    borrowerName: string | null;
    departmentUnit: string | null;
    borrowDate: string;
    dueDate: string;
    returnDate: string | null;
    status: string;
    nomorBerkas?: string | null;
    uraianBerkas?: string | null;
    kodeBoks?: string | null;
    namaBoks?: string | null;
}

/**
 * Hari keterlambatan: sampai hari ini untuk yang belum kembali, sampai tanggal
 * kembali untuk yang sudah kembali. Nol bila tidak terlambat.
 */
export function hariTerlambat(baris: Pick<BarisPeminjaman, 'dueDate' | 'returnDate' | 'status'>, hariIni: string): number {
    const sampai = baris.status === 'returned' ? baris.returnDate : hariIni;
    if (!sampai || !baris.dueDate) return 0;
    return Math.max(0, selisihHariKalender(baris.dueDate, sampai));
}

export function selPeminjaman(baris: BarisPeminjaman, nomor: number, hariIni: string): SelTabel[] {
    const boks = baris.lendingType === 'box';
    return [
        nomor,
        boks ? 'Boks' : 'Arsip',
        (boks ? baris.kodeBoks : baris.nomorBerkas) || '-',
        (boks ? baris.namaBoks : baris.uraianBerkas) || '-',
        baris.borrowerName || '-',
        baris.departmentUnit || '-',
        baris.borrowDate || '',
        baris.dueDate || '',
        baris.returnDate || '-',
        LABEL_STATUS[baris.status] ?? baris.status,
        hariTerlambat(baris, hariIni),
    ];
}

export const eksporPeminjamanService = {
    async tabel(saringan: SaringanEksporPeminjaman): Promise<TabelEkspor> {
        const hasil = await reportService.getLendingReport({
            unitKerjaId: saringan.unitKerjaId,
            status: saringan.status,
            tanggalDari: saringan.tanggalDari,
            tanggalSampai: saringan.tanggalSampai,
            securityClassifications: saringan.securityClassifications,
            page: 1,
            limit: EXPORT_ROW_LIMIT,
        });
        const data = requireCompleteExport(hasil) as BarisPeminjaman[];
        const unit = await namaUnitPengolah(saringan.unitKerjaId);
        const hariIni = jakartaDate();
        const periode = keteranganPeriodeLaporan(saringan);

        return {
            lembar: 'Peminjaman',
            judul: 'LAPORAN PEMINJAMAN ARSIP',
            keterangan: [
                unit,
                `Status: ${LABEL_STATUS[saringan.status]} | ${periode ? `${periode} (tanggal pinjam)` : 'Semua tanggal pinjam'}`,
            ],
            kolom: [
                { judul: 'No', lebarExcel: 6, lebarPdf: 25 },
                { judul: 'Jenis', lebarExcel: 9, lebarPdf: 35 },
                { judul: 'Nomor Berkas / Kode Boks', lebarExcel: 24, lebarPdf: 90, rataKiri: true },
                { judul: 'Uraian Berkas / Nama Boks', lebarExcel: 40, lebarPdf: 150, rataKiri: true },
                { judul: 'Peminjam', lebarExcel: 26, lebarPdf: 100, rataKiri: true },
                { judul: 'Unit/Instansi Peminjam', lebarExcel: 26, lebarPdf: 100, rataKiri: true },
                { judul: 'Tanggal Pinjam', lebarExcel: 14, lebarPdf: 55 },
                { judul: 'Jatuh Tempo', lebarExcel: 14, lebarPdf: 55 },
                { judul: 'Tanggal Kembali', lebarExcel: 14, lebarPdf: 55 },
                { judul: 'Status', lebarExcel: 14, lebarPdf: 60 },
                { judul: 'Hari Terlambat', lebarExcel: 11, lebarPdf: 45 },
            ],
            kolomLentur: 3,
            baris: data.map((baris, indeks) => selPeminjaman(baris, indeks + 1, hariIni)),
            total: `Total: ${data.length} peminjaman`,
        };
    },
};
