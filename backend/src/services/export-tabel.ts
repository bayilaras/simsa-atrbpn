import { loadExcelJS, loadPdfKit } from '../utils/lazy-libraries.js';
import { tanggalCetakWib } from '../utils/jakarta-date.js';
import {
    CENTER_ALIGN, DATA_FONT, HEADER_FILL, HEADER_FONT, LEBAR_TABEL_PDF, LEFT_ALIGN, SUBTITLE_FONT, THIN_BORDER,
    TITLE_FONT, WARNA_KEPALA_PDF,
} from './export-gaya.js';
import { batasBawahPdf, CATATAN_TEKS_DIPOTONG, lebarPenuh, tinggiBarisPdf, tulisBarisPdf } from './export-pdf-tabel.js';

/**
 * Daftar sederhana (satu baris kepala, satu baris per rekod) untuk rekap
 * peminjaman, disposisi, dan audit log. Excel dan PDF dibuat dari baris yang
 * sama sehingga isi keduanya tidak bisa berbeda.
 */
export type SelTabel = string | number;

export interface KolomTabel {
    judul: string;
    /** Lebar kolom Excel (satuan karakter). */
    lebarExcel: number;
    /** Lebar kolom PDF (pt) sebelum kolom lentur menyerap sisa lebar halaman. */
    lebarPdf: number;
    /** Teks panjang rata kiri; selain itu rata tengah. */
    rataKiri?: boolean;
}

export interface TabelEkspor {
    /** Nama lembar kerja Excel. */
    lembar: string;
    judul: string;
    /** Baris keterangan di bawah judul: unit, penyaring, periode. */
    keterangan: string[];
    kolom: KolomTabel[];
    /** Indeks kolom PDF yang menyerap sisa lebar halaman. */
    kolomLentur: number;
    baris: SelTabel[][];
    /** Tulisan jumlah di kaki PDF, mis. "Total: 12 peminjaman". */
    total: string;
}

/**
 * Isi sel selalu teks atau angka biasa. Teks ditulis ExcelJS sebagai sel
 * bertipe teks, jadi isian yang diawali "=", "+", "-", atau "@" tidak pernah
 * dihitung sebagai rumus; objek (mis. { formula }) tidak pernah diteruskan.
 */
export function selAman(nilai: unknown): SelTabel {
    if (typeof nilai === 'number') return Number.isFinite(nilai) ? nilai : '';
    if (nilai === null || nilai === undefined) return '';
    return typeof nilai === 'string' ? nilai : String(nilai);
}

export async function excelDariTabel(tabel: TabelEkspor): Promise<Buffer> {
    const { Workbook } = await loadExcelJS();
    const workbook = new Workbook();
    workbook.creator = 'SIMSA ATR/BPN';
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet(tabel.lembar, {
        pageSetup: { orientation: 'landscape', paperSize: 9 /* A4 */ },
    });
    const jumlahKolom = tabel.kolom.length;

    worksheet.mergeCells(1, 1, 1, jumlahKolom);
    const selJudul = worksheet.getCell(1, 1);
    selJudul.value = tabel.judul;
    selJudul.font = TITLE_FONT;
    selJudul.alignment = CENTER_ALIGN;

    tabel.keterangan.forEach((teks, i) => {
        worksheet.mergeCells(2 + i, 1, 2 + i, jumlahKolom);
        const sel = worksheet.getCell(2 + i, 1);
        sel.value = teks;
        sel.font = { ...SUBTITLE_FONT, bold: false };
        sel.alignment = CENTER_ALIGN;
    });

    const barisKepala = tabel.keterangan.length + 3;
    tabel.kolom.forEach((kolom, i) => {
        const sel = worksheet.getCell(barisKepala, i + 1);
        sel.value = kolom.judul;
        sel.font = HEADER_FONT;
        sel.fill = HEADER_FILL;
        sel.alignment = CENTER_ALIGN;
        sel.border = THIN_BORDER;
        worksheet.getColumn(i + 1).width = kolom.lebarExcel;
    });
    worksheet.getRow(barisKepala).height = 25;

    tabel.baris.forEach((baris, indeks) => {
        const nomorBaris = barisKepala + 1 + indeks;
        tabel.kolom.forEach((kolom, i) => {
            const sel = worksheet.getCell(nomorBaris, i + 1);
            sel.value = selAman(baris[i]);
            sel.font = DATA_FONT;
            sel.border = THIN_BORDER;
            sel.alignment = kolom.rataKiri ? LEFT_ALIGN : CENTER_ALIGN;
        });
    });

    return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function pdfDariTabel(tabel: TabelEkspor): Promise<Buffer> {
    const PDFDocument = await loadPdfKit();
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(16).font('Helvetica-Bold').text(tabel.judul, { align: 'center' });
        doc.fontSize(9).font('Helvetica');
        tabel.keterangan.forEach((teks) => doc.text(teks, { align: 'center' }));
        doc.text(`Dicetak: ${tanggalCetakWib()}`, { align: 'center' });
        doc.moveDown(1);

        const lebar = lebarPenuh(tabel.kolom.map((kolom) => kolom.lebarPdf), tabel.kolomLentur, LEBAR_TABEL_PDF);
        const judulKolom = tabel.kolom.map((kolom) => kolom.judul);
        const tata = { padX: 2, padY: 3, minimal: 15 };
        const batasBawah = batasBawahPdf(doc);

        // Kepala tabel diulang di tiap halaman; tingginya mengikuti judul terpanjang.
        const gambarKepala = (y: number): number => {
            doc.font('Helvetica-Bold').fontSize(7);
            const tinggi = tinggiBarisPdf(doc, judulKolom, lebar, tata);
            doc.rect(30, y, LEBAR_TABEL_PDF, tinggi).fill(WARNA_KEPALA_PDF);
            doc.fillColor('white');
            tulisBarisPdf(doc, judulKolom, lebar, 30, y, tata, tinggi);
            doc.font('Helvetica').fontSize(7).fillColor('black');
            return y + tinggi;
        };

        let yPos = gambarKepala(doc.y);
        let adaDipotong = false;
        tabel.baris.forEach((baris, indeks) => {
            const isi = tabel.kolom.map((_, i) => String(selAman(baris[i])));
            const tinggi = tinggiBarisPdf(doc, isi, lebar, tata);
            if (yPos + tinggi > batasBawah) {
                doc.addPage();
                yPos = gambarKepala(doc.page.margins.top);
            }
            if (indeks % 2 === 0) doc.rect(30, yPos, LEBAR_TABEL_PDF, tinggi).fill('#F5F5F5');
            doc.fillColor('black');
            adaDipotong = tulisBarisPdf(doc, isi, lebar, 30, yPos, tata, tinggi) || adaDipotong;
            yPos += tinggi;
        });

        if (yPos + 45 > batasBawah) {
            doc.addPage();
            yPos = doc.page.margins.top;
        }
        doc.fontSize(8).text(tabel.total, 30, yPos + 20);
        if (adaDipotong) doc.fontSize(7).text(CATATAN_TEKS_DIPOTONG, 30, yPos + 33);
        doc.end();
    });
}

export const JENIS_KONTEN = {
    excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pdf: 'application/pdf',
} as const;
export const AKHIRAN_BERKAS = { excel: 'xlsx', pdf: 'pdf' } as const;
export type FormatEkspor = keyof typeof JENIS_KONTEN;

export function berkasDariTabel(tabel: TabelEkspor, format: FormatEkspor): Promise<Buffer> {
    return format === 'excel' ? excelDariTabel(tabel) : pdfDariTabel(tabel);
}

/** Penyaring ekspor yang tidak dikenal ditolak (400), bukan diabaikan. */
export class SaringanEksporTidakSah extends Error {}

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

/** Parameter kosong berarti tidak disaring; selain itu harus salah satu pilihan. */
export function pilihanSaringan<T extends string>(nilai: unknown, pilihan: readonly T[], nama: string): T | undefined {
    if (nilai === undefined || nilai === '') return undefined;
    if (typeof nilai === 'string' && (pilihan as readonly string[]).includes(nilai)) return nilai as T;
    throw new SaringanEksporTidakSah(`Penyaring ${nama} tidak dikenali. Muat ulang halaman, lalu ekspor kembali.`);
}

/** Tanggal kalender YYYY-MM-DD yang benar-benar ada; kosong berarti tidak disaring. */
export function tanggalSaringan(nilai: unknown, nama: string): string | undefined {
    if (nilai === undefined || nilai === '') return undefined;
    if (typeof nilai === 'string' && POLA_TANGGAL.test(nilai)) {
        const waktu = new Date(`${nilai}T00:00:00.000Z`);
        if (!Number.isNaN(waktu.getTime()) && waktu.toISOString().slice(0, 10) === nilai) return nilai;
    }
    throw new SaringanEksporTidakSah(`${nama} tidak valid. Gunakan format tanggal YYYY-MM-DD.`);
}
