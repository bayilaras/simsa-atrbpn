import { ValidationError } from '../utils/errors.js';

export type GoogleSheetsImportType = 'surat-masuk' | 'surat-keluar';
type Column = { label: string; aliases: string[] };
const common: Record<string, Column> = {
    id: { label: 'ID sumber', aliases: ['id'] },
    noUrut: { label: 'Nomor urut sumber', aliases: ['no', 'nomor urut', 'no urut'] },
    nomorSurat: { label: 'Nomor surat', aliases: ['nomor surat', 'no surat', 'nomor'] },
    tanggalSurat: { label: 'Tanggal surat', aliases: ['tanggal surat', 'tgl surat', 'tanggal', 'tgl'] },
    perihal: { label: 'Perihal', aliases: ['perihal', 'subject', 'hal'] },
    kepada: { label: 'Kepada', aliases: ['kepada', 'tujuan', 'penerima', 'to'] },
};
const columns: Record<GoogleSheetsImportType, Record<string, Column>> = {
    'surat-masuk': {
        ...common,
        jenisSurat: { label: 'Jenis surat', aliases: ['jenis surat', 'jenis naskah', 'naskah dinas', 'jenis'] },
        sifatSurat: { label: 'Sifat surat', aliases: ['sifat surat', 'sifat', 'urgency'] },
        dari: { label: 'Pengirim', aliases: ['dari', 'asal', 'pengirim', 'from'] },
        status: { label: 'Status sumber', aliases: ['status', 'disposisi status'] },
        disposisi: { label: 'Disposisi', aliases: ['disposisi'] },
    },
    'surat-keluar': {
        ...common,
        naskahDinas: { label: 'Jenis naskah', aliases: ['jenis surat', 'naskah dinas', 'jenis naskah', 'jenis'] },
        linkDokumen: { label: 'Tautan dokumen', aliases: ['link dokumen', 'link', 'url'] },
        klasifikasiArsip: { label: 'Klasifikasi arsip', aliases: ['klasifikasi arsip', 'klasifikasi'] },
        klasifikasiKode: { label: 'Kode klasifikasi', aliases: ['klasifikasi kode', 'kode klasifikasi', 'kode'] },
        klasifikasiJenis: { label: 'Jenis klasifikasi', aliases: ['klasifikasi jenis', 'jenis klasifikasi'] },
    },
};

// Punctuation separates words: "No. Surat" is "no surat", never "nomor urut".
export function normalizeSheetHeader(value: string): string {
    return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export interface SheetColumnMapping { field: string; label: string; columnIndex: number; header: string }
export function resolveSheetMapping(rows: string[][], importType: GoogleSheetsImportType) {
    const definitions = columns[importType];
    if (!definitions) throw new ValidationError('Jenis impor Google Sheets tidak valid.');
    const recognized = new Set(Object.values(definitions).flatMap(column => column.aliases));
    const headerRowIndex = rows.slice(0, 5).findIndex(row =>
        new Set(row.map(normalizeSheetHeader).filter(header => recognized.has(header))).size >= 3);
    if (headerRowIndex < 0) throw new ValidationError('Header sheet tidak dikenali. Gunakan nama kolom surat yang jelas pada lima baris pertama.');
    const headers = rows[headerRowIndex];
    const normalized = headers.map(normalizeSheetHeader);
    const mapping: SheetColumnMapping[] = [];
    const columnMap: Record<string, number> = {};
    for (const [field, definition] of Object.entries(definitions)) {
        const matches = normalized.flatMap((header, index) => definition.aliases.includes(header) ? [index] : []);
        if (matches.length > 1) throw new ValidationError(
            `Pemetaan ${definition.label} ambigu pada kolom ${matches.map(index => index + 1).join(', ')}. Sisakan satu kolom yang sesuai.`,
        );
        if (matches.length === 1) {
            const columnIndex = matches[0];
            columnMap[field] = columnIndex;
            mapping.push({ field, label: definition.label, columnIndex, header: headers[columnIndex] });
        }
    }
    const required = ['nomorSurat', 'tanggalSurat', 'perihal', importType === 'surat-masuk' ? 'dari' : 'kepada'];
    const missing = required.filter(field => columnMap[field] === undefined);
    if (missing.length) throw new ValidationError(
        `Kolom wajib belum ditemukan: ${missing.map(field => definitions[field].label).join(', ')}. Perbaiki header sebelum impor.`,
    );
    return { headers, headerRowIndex, columnMap, mapping };
}
