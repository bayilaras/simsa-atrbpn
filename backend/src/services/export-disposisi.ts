import { distributionService } from './distribution.service';
import { EXPORT_ROW_LIMIT, requireCompleteExport } from './export-completeness.js';
import { namaUnitPengolah } from './export-unit-pengolah.js';
import { jakartaDate, waktuWib } from '../utils/jakarta-date.js';
import type { SelTabel, TabelEkspor } from './export-tabel.js';
import type { RecordUser } from './record-access.service.js';

/**
 * Rekap tindak lanjut disposisi dari halaman Distribusi. Barisnya diambil
 * lewat distributionService.findInbox / findOutbox, panggilan yang sama dengan
 * Kotak Masuk dan Kotak Keluar di layar, jadi cakupan unit, kelas keamanan,
 * dan penyamaran baris "Dikecualikan" identik dengan yang tampil.
 */
export const KOTAK_DISPOSISI = ['inbox', 'outbox'] as const;
export type KotakDisposisi = typeof KOTAK_DISPOSISI[number];
export const STATUS_DISPOSISI = ['sent', 'received', 'processed', 'rejected'] as const;
export type StatusDisposisi = typeof STATUS_DISPOSISI[number];

export interface SaringanEksporDisposisi {
    kotak: KotakDisposisi;
    unitKerjaId: string;
    status?: StatusDisposisi;
    /** Hanya Kotak Masuk: disposisi terbuka yang lewat batas waktu. */
    lewatBatas?: boolean;
}

// Sama dengan label status di halaman Distribusi.
const LABEL_STATUS: Record<string, string> = {
    sent: 'Menunggu',
    received: 'Diterima',
    processed: 'Selesai',
    rejected: 'Ditolak',
};
const LABEL_KOTAK: Record<KotakDisposisi, string> = { inbox: 'KOTAK MASUK', outbox: 'KOTAK KELUAR' };
/** Teks kolom Nomor Surat untuk surat yang tidak boleh dibaca, sama dengan di layar. */
export const TEKS_DIKECUALIKAN = 'Dikecualikan';

export interface BarisDisposisi {
    masked?: boolean;
    status: string;
    instruction?: string | null;
    catatanPenyelesaian?: string | null;
    rejectionReason?: string | null;
    batasWaktu?: string | null;
    sentAt?: Date | string | null;
    receivedAt?: Date | string | null;
    processedAt?: Date | string | null;
    surat?: { nomorSurat?: string | null; perihal?: string | null } | null;
    sourceUnit?: { name?: string | null } | null;
    targetUnit?: { name?: string | null } | null;
}

/**
 * Baris Kotak Masuk hanya dianggap terbaca bila layanan menandainya
 * `masked: false`; tanpa tanda itu baris diperlakukan tersamar (gagal
 * tertutup). Kotak Keluar tidak menyamarkan: surat yang kelasnya tidak boleh
 * dibaca sudah dikeluarkan oleh findOutbox.
 */
export function barisTersamar(baris: BarisDisposisi, kotak: KotakDisposisi): boolean {
    return kotak === 'inbox' ? baris.masked !== false : baris.masked === true;
}

/** Lewat batas seperti penanda merah di layar: masih terbuka dan batas waktunya sebelum hari ini (WIB). */
export function lewatBatasWaktu(baris: Pick<BarisDisposisi, 'batasWaktu' | 'status'>, hariIni: string): boolean {
    return Boolean(baris.batasWaktu) && String(baris.batasWaktu) < hariIni && ['sent', 'received'].includes(baris.status);
}

function catatan(baris: BarisDisposisi): string {
    if (baris.status === 'rejected' && baris.rejectionReason) return `Alasan ditolak: ${baris.rejectionReason}`;
    return baris.catatanPenyelesaian || '-';
}

export function selDisposisi(
    baris: BarisDisposisi, nomor: number, kotak: KotakDisposisi, namaUnitKotak: string, hariIni: string,
): SelTabel[] {
    // Bidang isi surat tidak pernah dibaca dari baris tersamar, apa pun isinya.
    const tersamar = barisTersamar(baris, kotak);
    return [
        nomor,
        tersamar ? TEKS_DIKECUALIKAN : (baris.surat?.nomorSurat || '-'),
        tersamar ? '-' : (baris.surat?.perihal || '-'),
        kotak === 'inbox' ? (baris.sourceUnit?.name || '-') : namaUnitKotak,
        kotak === 'inbox' ? namaUnitKotak : (baris.targetUnit?.name || '-'),
        tersamar ? '-' : (baris.instruction || '-'),
        tersamar ? '-' : catatan(baris),
        baris.batasWaktu || '-',
        LABEL_STATUS[baris.status] ?? baris.status,
        waktuWib(baris.sentAt) || '-',
        waktuWib(baris.receivedAt) || '-',
        baris.status === 'processed' ? (waktuWib(baris.processedAt) || '-') : '-',
        lewatBatasWaktu(baris, hariIni) ? 'Ya' : 'Tidak',
    ];
}

export const eksporDisposisiService = {
    async tabel(saringan: SaringanEksporDisposisi, user: RecordUser | undefined, securityClassifications: string[]): Promise<TabelEkspor> {
        const halaman = { status: saringan.status, page: 1, limit: EXPORT_ROW_LIMIT };
        const hasil = saringan.kotak === 'inbox'
            ? await distributionService.findInbox(saringan.unitKerjaId, { ...halaman, lewatBatas: saringan.lewatBatas === true }, user)
            : await distributionService.findOutbox(saringan.unitKerjaId, halaman, securityClassifications);
        const data = requireCompleteExport<BarisDisposisi>(hasil);
        const unit = await namaUnitPengolah(saringan.unitKerjaId);
        const hariIni = jakartaDate();
        const penyaring = [
            `Status: ${saringan.status ? LABEL_STATUS[saringan.status] : 'Semua'}`,
            ...(saringan.lewatBatas ? ['Lewat batas waktu'] : []),
        ].join(' | ');

        return {
            lembar: saringan.kotak === 'inbox' ? 'Kotak Masuk' : 'Kotak Keluar',
            judul: `REKAP DISPOSISI - ${LABEL_KOTAK[saringan.kotak]}`,
            keterangan: [unit, penyaring],
            kolom: [
                { judul: 'No', lebarExcel: 6, lebarPdf: 22 },
                { judul: 'Nomor Surat', lebarExcel: 26, lebarPdf: 80, rataKiri: true },
                { judul: 'Perihal', lebarExcel: 40, lebarPdf: 120, rataKiri: true },
                { judul: 'Unit Asal', lebarExcel: 24, lebarPdf: 65, rataKiri: true },
                { judul: 'Unit Tujuan', lebarExcel: 24, lebarPdf: 65, rataKiri: true },
                { judul: 'Instruksi', lebarExcel: 32, lebarPdf: 85, rataKiri: true },
                { judul: 'Catatan', lebarExcel: 32, lebarPdf: 80, rataKiri: true },
                { judul: 'Batas Waktu', lebarExcel: 13, lebarPdf: 45 },
                { judul: 'Status', lebarExcel: 12, lebarPdf: 42 },
                { judul: 'Tanggal Dikirim', lebarExcel: 22, lebarPdf: 50 },
                { judul: 'Tanggal Diterima', lebarExcel: 22, lebarPdf: 50 },
                { judul: 'Tanggal Selesai', lebarExcel: 22, lebarPdf: 50 },
                { judul: 'Lewat Batas', lebarExcel: 10, lebarPdf: 28 },
            ],
            kolomLentur: 2,
            baris: data.map((baris, indeks) => selDisposisi(baris, indeks + 1, saringan.kotak, unit, hariIni)),
            total: `Total: ${data.length} disposisi`,
        };
    },
};
