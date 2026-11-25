import type ExcelJS from 'exceljs';

/** Gaya sel berkas Excel ekspor, sama untuk semua daftar. */
export const HEADER_FILL: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A5F' },
};
export const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
export const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 14, name: 'Arial' };
export const SUBTITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 10, name: 'Arial' };
export const DATA_FONT: Partial<ExcelJS.Font> = { size: 9, name: 'Arial' };
export const THIN_BORDER: Partial<ExcelJS.Borders> = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
};
export const CENTER_ALIGN: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };
export const LEFT_ALIGN: Partial<ExcelJS.Alignment> = { horizontal: 'left', vertical: 'middle', wrapText: true };
/** Lebar tabel PDF A4 lanskap dengan margin 30 pt. */
export const LEBAR_TABEL_PDF = 782;
/** Warna kepala tabel PDF, sama dengan kepala tabel Excel. */
export const WARNA_KEPALA_PDF = '#1E3A5F';
