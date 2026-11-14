import { ValidationError } from '../utils/errors.js';

export type GoogleSheetsImportType = 'surat-masuk' | 'surat-keluar';
/**
 * stored false: recognised, so the column is never taken for another one, but the import does not keep its value.
 * `keterangan` is shown with the label in the preview mapping, not in error messages.
 */
type Column = { label: string; aliases: string[]; stored?: false; keterangan?: string };
// An agenda-number title wins over a plain "No" row counter in the same sheet.
const NOMOR_AGENDA_ALIASES = ['no agenda', 'nomor agenda'];
// The source number becomes the letter's own No. Agenda / No. Urut when that number is still free.
const nomorUrut = (label: string): Column => ({
    label, aliases: ['no', 'nomor urut', 'no urut', ...NOMOR_AGENDA_ALIASES], keterangan: 'disimpan bila belum dipakai',
});
const common: Record<string, Column> = {
    id: { label: 'ID sumber', aliases: ['id'], stored: false },
    noUrut: nomorUrut('No. Urut'),
    nomorSurat: { label: 'Nomor surat', aliases: ['nomor surat', 'no surat', 'nomor'] },
    tanggalSurat: { label: 'Tanggal surat', aliases: ['tanggal surat', 'tgl surat', 'tanggal', 'tgl'] },
    perihal: { label: 'Perihal', aliases: ['perihal', 'subject', 'hal'] },
    kepada: { label: 'Kepada', aliases: ['kepada', 'tujuan', 'penerima', 'to'] },
};
const columns: Record<GoogleSheetsImportType, Record<string, Column>> = {
    'surat-masuk': {
        ...common,
        noUrut: nomorUrut('No. Agenda'),
        jenisSurat: { label: 'Jenis surat', aliases: ['jenis surat', 'jenis naskah', 'naskah dinas', 'jenis'] },
        sifatSurat: { label: 'Sifat surat', aliases: ['sifat surat', 'sifat', 'urgency'] },
        dari: { label: 'Pengirim', aliases: ['dari', 'asal', 'pengirim', 'from'] },
        // An imported letter always starts as not yet answered.
        status: { label: 'Status sumber', aliases: ['status', 'disposisi status'], stored: false },
        disposisi: { label: 'Disposisi', aliases: ['disposisi'] },
    },
    'surat-keluar': {
        ...common,
        naskahDinas: { label: 'Jenis naskah', aliases: ['jenis surat', 'naskah dinas', 'jenis naskah', 'jenis'] },
        sifatSurat: { label: 'Sifat surat', aliases: ['sifat surat', 'sifat', 'urgency'] },
        linkDokumen: { label: 'Tautan dokumen', aliases: ['link dokumen', 'link', 'url', 'get link'] },
        klasifikasiArsip: { label: 'Klasifikasi arsip', aliases: ['klasifikasi arsip', 'klasifikasi'] },
        klasifikasiKode: { label: 'Kode klasifikasi', aliases: ['klasifikasi kode', 'kode klasifikasi', 'kode'] },
        klasifikasiJenis: { label: 'Jenis klasifikasi', aliases: ['klasifikasi jenis', 'jenis klasifikasi'] },
    },
};

export function isWebAddress(value: string | undefined): boolean {
    return /^https?:\/\/\S+$/i.test(value?.trim() || '');
}

// Punctuation separates words: "No. Surat" is "no surat", never "nomor urut".
export function normalizeSheetHeader(value: string): string {
    return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export interface SheetColumnMapping {
    field: string; label: string; columnIndex: number; header: string;
    /** Present (false) only for a recognised column whose value the import does not store. */
    stored?: false;
}

const labelPemetaan = (column: Column) => column.keterangan ? `${column.label} (${column.keterangan})` : column.label;

/** The header is the first of the first five rows with at least three recognised titles; -1 when none. */
function findHeaderRow(rows: string[][], definitions: Record<string, Column>): number {
    const recognized = new Set(Object.values(definitions).flatMap(column => column.aliases));
    return rows.slice(0, 5).findIndex(row =>
        new Set(row.map(normalizeSheetHeader).filter(header => recognized.has(header))).size >= 3);
}

/** The header row and every column titled as a document link (none for incoming letters). */
export function linkColumns(rows: string[][], importType: GoogleSheetsImportType): { headerRowIndex: number; columns: number[] } {
    const definitions = columns[importType];
    const link = definitions?.linkDokumen;
    const headerRowIndex = definitions ? findHeaderRow(rows, definitions) : -1;
    if (!link || headerRowIndex < 0) return { headerRowIndex, columns: [] };
    return { headerRowIndex, columns: rows[headerRowIndex].flatMap((header, index) =>
        link.aliases.includes(normalizeSheetHeader(header)) ? [index] : []) };
}

export function resolveSheetMapping(rows: string[][], importType: GoogleSheetsImportType) {
    const definitions = columns[importType];
    if (!definitions) throw new ValidationError('Jenis impor Google Sheets tidak valid.');
    const headerRowIndex = findHeaderRow(rows, definitions);
    if (headerRowIndex < 0) throw new ValidationError('Header sheet tidak dikenali. Gunakan nama kolom surat yang jelas pada lima baris pertama.');
    const headers = rows[headerRowIndex];
    const normalized = headers.map(normalizeSheetHeader);
    const mapping: SheetColumnMapping[] = [];
    const columnMap: Record<string, number> = {};
    for (const [field, definition] of Object.entries(definitions)) {
        let matches = normalized.flatMap((header, index) => definition.aliases.includes(header) ? [index] : []);
        // Registers often pair a "file" label column with the URL column under one heading.
        // In a downloaded workbook the label may itself link to the file, so the link column
        // is the one holding every URL the other columns hold, row by row.
        if (field === 'linkDokumen' && matches.length > 1) {
            const dataRows = rows.slice(headerRowIndex + 1);
            const withUrls = matches.filter(index => dataRows.some(row => isWebAddress(row[index])));
            const covering = withUrls.filter(index => dataRows.every(row => withUrls.every(other =>
                !isWebAddress(row[other]) || row[index]?.trim() === row[other].trim())));
            if (covering.length) matches = [covering[0]];
        }
        // A register with a row counter ("No") and an agenda number ("No. Agenda") keeps the agenda number.
        if (field === 'noUrut' && matches.length > 1) {
            const agenda = matches.filter(index => NOMOR_AGENDA_ALIASES.includes(normalized[index]));
            if (agenda.length === 1) matches = agenda;
        }
        if (matches.length > 1) throw new ValidationError(
            `Pemetaan ${definition.label} ambigu pada kolom ${matches.map(index => index + 1).join(', ')}. Sisakan satu kolom yang sesuai.`,
        );
        if (matches.length === 1) {
            const columnIndex = matches[0];
            columnMap[field] = columnIndex;
            mapping.push({ field, label: labelPemetaan(definition), columnIndex, header: headers[columnIndex], ...(definition.stored === false ? { stored: false } : {}) });
        }
    }
    // A classification code and title are stored as fasilitatif or substantif, as the
    // type column of the row says; without a type column, or with nothing to sort, none is stored.
    const typed = columnMap.klasifikasiJenis !== undefined;
    const described = columnMap.klasifikasiArsip !== undefined || columnMap.klasifikasiKode !== undefined;
    for (const item of mapping) {
        if ((item.field === 'klasifikasiArsip' || item.field === 'klasifikasiKode') && !typed) item.stored = false;
        if (item.field === 'klasifikasiJenis' && !described) item.stored = false;
    }
    // A register's title can run into its first header ("SURAT KELUAR 2026 No" in a
    // Google Sheets CSV export). Without an exact sequence title, a first column whose
    // title ends in the word "No" after other words is the sequence column.
    const first = normalized[0] ?? '';
    if (columnMap.noUrut === undefined && / no$/.test(first) && !Object.values(columnMap).includes(0)) {
        columnMap.noUrut = 0;
        mapping.push({ field: 'noUrut', label: labelPemetaan(definitions.noUrut), columnIndex: 0, header: headers[0] });
    }
    // Outgoing registers often omit the recipient; incoming letters always need a sender.
    const required = ['nomorSurat', 'tanggalSurat', 'perihal', ...(importType === 'surat-masuk' ? ['dari'] : [])];
    const missing = required.filter(field => columnMap[field] === undefined);
    if (missing.length) throw new ValidationError(
        `Kolom wajib belum ditemukan: ${missing.map(field => definitions[field].label).join(', ')}. Perbaiki header sebelum impor.`,
    );
    return { headers, headerRowIndex, columnMap, mapping };
}
