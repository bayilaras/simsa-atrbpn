import { inflateRawSync } from 'node:zlib';
import type ExcelJS from 'exceljs';
import { PayloadTooLargeError, ValidationError } from '../utils/errors.js';
import { loadExcelJS } from '../utils/lazy-libraries.js';
import { GOOGLE_SHEETS_LIMITS, assertSheetName, parseBoundedSheetCsv, type CsvDelimiter } from './google-sheets-source.js';
import { isWebAddress } from './google-sheets-import-mapping.js';

/**
 * Uploaded CSV/XLSX import files become the same rows a Google Sheets CSV
 * export gives (string[][], empty rows left out), so the shared import path
 * maps and imports them. The file is read from memory and never stored.
 */
export const IMPORT_FILE_LIMITS = Object.freeze({
    // Below Vercel's 4.5 MB request-body limit, with room for the multipart envelope.
    bytes: 4 * 1024 * 1024,
    // Everything exceljs decompresses, checked before it reads the package.
    unpackedBytes: 16 * 1024 * 1024,
    zipEntries: 1_000,
    sheets: GOOGLE_SHEETS_LIMITS.sheets,
    rows: GOOGLE_SHEETS_LIMITS.rows,
    columns: GOOGLE_SHEETS_LIMITS.columns,
    fieldBytes: GOOGLE_SHEETS_LIMITS.fieldBytes,
});

export type ImportFileFormat = 'csv' | 'xlsx';
export interface ImportFileSheet { name: string; hidden: boolean }
export interface ImportFileUpload { originalname: string; mimetype: string; buffer: Buffer }
export interface ImportFileContent {
    format: ImportFileFormat;
    sheets: ImportFileSheet[];
    sheet: string | null;
    rows: string[][];
    /** Per row, the web address of each linked cell by column index (XLSX only). */
    links: Array<Record<number, string> | undefined>;
}

// Browsers report the type from the operating system; Windows with Excel calls a .csv "application/vnd.ms-excel".
const MIME_TYPES: Record<ImportFileFormat, ReadonlySet<string>> = {
    csv: new Set(['text/csv', 'application/csv', 'text/x-csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream']),
    xlsx: new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream']),
};
const ZIP_MAGIC = Buffer.from('504b0304', 'hex');
// Compound File Binary: an encrypted OOXML workbook or a legacy .xls.
const OLE_MAGIC = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const WORKBOOK_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const KB = (bytes: number) => `${bytes / 1024} KiB`;

/** The format named by the extension, when the browser-reported type agrees with it. */
export function assertImportFileType(originalname: string, mimetype: string): ImportFileFormat {
    const format = /\.csv$/i.test(originalname) ? 'csv' : /\.xlsx$/i.test(originalname) ? 'xlsx' : null;
    if (!format) throw new ValidationError('Gunakan berkas .csv atau .xlsx. Simpan berkas .xls, .xlsm, atau .ods sebagai Excel Workbook (.xlsx) terlebih dahulu.');
    if (!MIME_TYPES[format].has(mimetype.toLowerCase())) throw new ValidationError('Jenis berkas tidak sesuai dengan ekstensinya. Simpan ulang berkas sebagai CSV atau Excel Workbook (.xlsx).');
    return format;
}

function assertImportFileContent(format: ImportFileFormat, buffer: Buffer): void {
    if (buffer.length === 0) throw new ValidationError('Berkas kosong.');
    if (buffer.length > IMPORT_FILE_LIMITS.bytes) throw new PayloadTooLargeError('Berkas melebihi batas 4 MiB. Pecah data menjadi beberapa berkas.');
    if (buffer.subarray(0, OLE_MAGIC.length).equals(OLE_MAGIC)) {
        throw new ValidationError('Berkas berkata sandi (terenkripsi) atau format Excel lama (.xls) tidak didukung. Buka di Excel, hapus kata sandi, lalu simpan sebagai Excel Workbook (.xlsx).');
    }
    const zip = buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC);
    if (format === 'xlsx' && !zip) throw new ValidationError('Isi berkas bukan XLSX yang valid. Simpan ulang sebagai Excel Workbook (.xlsx).');
    if (format === 'csv' && zip) throw new ValidationError('Isi berkas adalah buku kerja Excel; unggah dengan ekstensi .xlsx.');
    if (format === 'csv' && buffer.includes(0)) {
        throw new ValidationError('CSV harus berupa teks. Di Excel pilih "CSV UTF-8 (Comma delimited)" saat menyimpan.');
    }
}

const CSV_DELIMITERS: readonly CsvDelimiter[] = [',', ';', '\t'];

/**
 * Excel writes CSV with the list separator of the regional settings, which
 * is ";" in Indonesia. The separator used most outside quotes in the first
 * records wins; a tie keeps ",".
 */
function csvDelimiter(text: string): CsvDelimiter {
    const counts = new Map<string, number>(CSV_DELIMITERS.map(delimiter => [delimiter, 0]));
    let quoted = false;
    for (let i = 0, records = 0; i < text.length && i < 64 * 1024 && records < 10; i++) {
        const char = text[i];
        if (char === '"') quoted = !quoted;
        else if (!quoted && char === '\n') records++;
        else if (!quoted && counts.has(char)) counts.set(char, counts.get(char)! + 1);
    }
    return CSV_DELIMITERS.reduce((best, delimiter) => counts.get(delimiter)! > counts.get(best)! ? delimiter : best);
}

function readCsvRows(buffer: Buffer): string[][] {
    let text: string;
    // "CSV UTF-8" from Excel or a Google Sheets download; otherwise Excel's plain "CSV" in the Windows code page.
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { text = new TextDecoder('windows-1252').decode(buffer); }
    return parseBoundedSheetCsv(text, csvDelimiter(text));
}

interface ZipEntry { name: string; method: number; compressedSize: number; size: number; localOffset: number }

/**
 * JSZip renames parts it reads: it resolves "." and ".." segments and empty
 * segments, and takes an Info-ZIP Unicode Path extra field over the stored
 * name. Accepting only names it keeps as they are means the parts checked
 * here are the parts exceljs reads, under the same names.
 */
function canonicalPartName(name: string): boolean {
    if (!/^[\x20-\x7e]+$/.test(name)) return false;
    const segments = name.split('/');
    // A directory entry ends with "/".
    return segments.every((segment, index) => segment !== '.' && segment !== '..'
        && (segment !== '' || (index > 0 && index === segments.length - 1)));
}

function hasUnicodePathField(buffer: Buffer, start: number, end: number): boolean {
    for (let position = start; position + 4 <= end; position += 4 + buffer.readUInt16LE(position + 2)) {
        if (buffer.readUInt16LE(position) === 0x7075) return true;
    }
    return false;
}

function zipEntries(buffer: Buffer): ZipEntry[] {
    const invalid = () => new ValidationError('Isi berkas bukan XLSX yang valid. Simpan ulang sebagai Excel Workbook (.xlsx).');
    // The last end-of-central-directory record, as JSZip finds it.
    let end = -1;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw invalid();
    const count = buffer.readUInt16LE(end + 10);
    const directorySize = buffer.readUInt32LE(end + 12);
    const directoryOffset = buffer.readUInt32LE(end + 16);
    // ZIP64 and multi-disk archives are far beyond a 4 MiB workbook. The directory must end
    // where the record starts: JSZip shifts every offset by any gap, and would then read
    // entries other than the ones bounded here.
    if (buffer.readUInt16LE(end + 4) !== 0 || buffer.readUInt16LE(end + 6) !== 0 || buffer.readUInt16LE(end + 8) !== count
        || count === 0xffff || directoryOffset === 0xffffffff || directoryOffset + directorySize !== end) throw invalid();
    if (count > IMPORT_FILE_LIMITS.zipEntries) throw new PayloadTooLargeError(`Paket XLSX berisi lebih dari ${IMPORT_FILE_LIMITS.zipEntries} bagian.`);
    const entries: ZipEntry[] = [];
    let position = directoryOffset;
    for (let i = 0; i < count; i++) {
        if (position + 46 > end || buffer.readUInt32LE(position) !== 0x02014b50) throw invalid();
        const flags = buffer.readUInt16LE(position + 8);
        const method = buffer.readUInt16LE(position + 10);
        const nameLength = buffer.readUInt16LE(position + 28);
        const extraStart = position + 46 + nameLength;
        const extraEnd = extraStart + buffer.readUInt16LE(position + 30);
        const next = extraEnd + buffer.readUInt16LE(position + 32);
        if (next > end) throw invalid();
        if (flags & 0x41) throw new ValidationError('Bagian XLSX terenkripsi tidak didukung. Hapus kata sandi lalu simpan ulang sebagai Excel Workbook (.xlsx).');
        const name = buffer.toString('latin1', position + 46, extraStart);
        if ((method !== 0 && method !== 8) || !canonicalPartName(name) || hasUnicodePathField(buffer, extraStart, extraEnd)) throw invalid();
        entries.push({
            name,
            method, compressedSize: buffer.readUInt32LE(position + 20), size: buffer.readUInt32LE(position + 24),
            localOffset: buffer.readUInt32LE(position + 42),
        });
        position = next;
    }
    if (position !== end) throw invalid();
    return entries;
}

function inflateEntry(buffer: Buffer, entry: ZipEntry): Buffer {
    const invalid = new ValidationError('Isi berkas XLSX rusak. Simpan ulang sebagai Excel Workbook (.xlsx).');
    const local = entry.localOffset;
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) throw invalid;
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + entry.compressedSize > buffer.length) throw invalid;
    const data = buffer.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) {
        if (entry.compressedSize !== entry.size) throw invalid;
        return data;
    }
    // A part may not inflate beyond the size the archive declares for it.
    let inflated: Buffer;
    try { inflated = inflateRawSync(data, { maxOutputLength: Math.max(1, entry.size) }); } catch { throw invalid; }
    if (inflated.length !== entry.size) throw invalid;
    return inflated;
}

/**
 * Check an XLSX package and return its parts. Every bound exceljs could
 * exceed while decompressing is enforced here first: part count, the
 * declared and actual unpacked size, encryption, macros, and the workbook
 * content type.
 */
export function unpackXlsx(buffer: Buffer): Map<string, Buffer> {
    const entries = zipEntries(buffer);
    const names = new Set<string>();
    let unpacked = 0;
    let worksheets = 0;
    for (const { name, size } of entries) {
        if (names.has(name)) throw new ValidationError('Isi berkas XLSX rusak. Simpan ulang sebagai Excel Workbook (.xlsx).');
        names.add(name);
        if (/(?:^|\/)vbaProject(?:Signature)?\.bin$/i.test(name) || /^xl\/(?:macrosheets|dialogsheets|activeX)\//i.test(name)) {
            throw new ValidationError('Buku kerja bermakro tidak didukung. Simpan sebagai Excel Workbook (.xlsx) tanpa makro.');
        }
        if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) worksheets++;
        unpacked += size;
    }
    if (unpacked > IMPORT_FILE_LIMITS.unpackedBytes) throw new PayloadTooLargeError('Isi berkas XLSX terlalu besar setelah diekstrak. Hapus lembar atau gambar yang tidak diperlukan.');
    if (worksheets > IMPORT_FILE_LIMITS.sheets) throw new PayloadTooLargeError(`Buku kerja berisi lebih dari ${IMPORT_FILE_LIMITS.sheets} lembar kerja.`);
    const parts = new Map(entries.map(entry => [entry.name, inflateEntry(buffer, entry)]));
    const types = parts.get('[Content_Types].xml')?.toString('utf8') ?? '';
    if (/macroEnabled/i.test(types)) throw new ValidationError('Buku kerja bermakro tidak didukung. Simpan sebagai Excel Workbook (.xlsx) tanpa makro.');
    if (!types.includes(WORKBOOK_TYPE) || !parts.has('xl/workbook.xml')) {
        throw new ValidationError('Isi berkas bukan buku kerja XLSX. Simpan sebagai Excel Workbook (.xlsx), bukan templat.');
    }
    return parts;
}

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
    unpackXlsx(buffer);
    const { Workbook } = await loadExcelJS();
    const workbook = new Workbook();
    try {
        // exceljs expands every data-validation range cell by cell; a whole-column list would never finish.
        await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer, { ignoreNodes: ['dataValidations', 'conditionalFormatting', 'extLst'] } as ExcelJS.XlsxReadOptions);
    } catch {
        throw new ValidationError('Berkas XLSX tidak dapat dibaca. Buka di Excel lalu simpan ulang sebagai Excel Workbook (.xlsx).');
    }
    if (!workbook.worksheets.length) throw new ValidationError('Berkas XLSX tidak dapat dibaca: tidak ada lembar kerja.');
    return workbook;
}

function sheetList(workbook: ExcelJS.Workbook): ImportFileSheet[] {
    return workbook.worksheets.map(sheet => ({ name: sheet.name, hidden: sheet.state !== 'visible' }));
}

function selectWorksheet(workbook: ExcelJS.Workbook, name: string | undefined): ExcelJS.Worksheet {
    if (name === undefined) {
        if (workbook.worksheets.length > 1) throw new ValidationError('Pilih lembar kerja yang akan diimpor.');
        return workbook.worksheets[0];
    }
    assertSheetName(name);
    const sheet = workbook.worksheets.find(candidate => candidate.name === name);
    if (!sheet) throw new ValidationError(`Lembar kerja "${name}" tidak ditemukan dalam berkas.`);
    return sheet;
}

const pad = (value: number) => String(value).padStart(2, '0');
// exceljs reads Excel serials as UTC instants; the calendar date is the UTC date.
const isoDate = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/** The URL of HYPERLINK("https://…", …); a computed target ("…"&D5) has none. */
function hyperlinkFormulaTarget(formula: string | undefined): string | null {
    const literal = /^\s*=?\s*HYPERLINK\(\s*"((?:[^"]|"")*)"\s*[,)]/i.exec(formula || '')?.[1];
    const target = literal?.replace(/""/g, '"');
    return target && isWebAddress(target) ? target.trim() : null;
}

/** A cell as its displayed text, except dates, which become YYYY-MM-DD. */
function valueText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : isoDate(value);
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if ('hyperlink' in value) return valueText(value.text as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map(part => part.text).join('');
    if ('formula' in value || 'sharedFormula' in value) return valueText(value.result as ExcelJS.CellValue);
    if ('error' in value) return value.error;
    return '';
}

/** The web address a cell links to, if any. */
function cellLink(cell: ExcelJS.Cell, ValueType: typeof ExcelJS.ValueType): string | null {
    if (cell.type === ValueType.Hyperlink) {
        const { hyperlink } = cell.value as ExcelJS.CellHyperlinkValue;
        return isWebAddress(hyperlink) ? hyperlink.trim() : null;
    }
    // cell.formula also resolves a formula shared down a column.
    return cell.type === ValueType.Formula ? hyperlinkFormulaTarget(cell.formula) : null;
}

function sheetRows(sheet: ExcelJS.Worksheet, ValueType: typeof ExcelJS.ValueType): Pick<ImportFileContent, 'rows' | 'links'> {
    const rows: string[][] = [];
    const links: ImportFileContent['links'] = [];
    sheet.eachRow(row => {
        const values: string[] = [];
        let rowLinks: Record<number, string> | undefined;
        row.eachCell((cell, column) => {
            // A merged range keeps its value in the first cell only, as a Google Sheets CSV export does.
            if (cell.type === ValueType.Merge) return;
            const link = cellLink(cell, ValueType);
            // Like a Google Sheets CSV export, a linked cell reads as its text; an empty text shows the address.
            const text = valueText(cell.value).trim() || link || '';
            if (!text) return;
            if (column > IMPORT_FILE_LIMITS.columns) throw new PayloadTooLargeError(`Lembar kerja melebihi batas ${IMPORT_FILE_LIMITS.columns} kolom.`);
            if (Buffer.byteLength(text, 'utf8') > IMPORT_FILE_LIMITS.fieldBytes || Buffer.byteLength(link || '', 'utf8') > IMPORT_FILE_LIMITS.fieldBytes) {
                throw new PayloadTooLargeError(`Isi sel melebihi batas ${KB(IMPORT_FILE_LIMITS.fieldBytes)}.`);
            }
            values[column - 1] = text;
            if (link) (rowLinks ??= {})[column - 1] = link;
        });
        if (!values.length) return;
        if (rows.length >= IMPORT_FILE_LIMITS.rows) throw new PayloadTooLargeError('Lembar kerja melebihi batas 1.005 baris berisi termasuk judul. Pecah data sebelum impor.');
        rows.push(Array.from(values, value => value ?? ''));
        links.push(rowLinks);
    });
    return { rows, links };
}

/** The tabs of an XLSX file; a CSV file has none. */
export async function listImportFileSheets(file: ImportFileUpload): Promise<{ format: ImportFileFormat; sheets: ImportFileSheet[] }> {
    const format = assertImportFileType(file.originalname, file.mimetype);
    assertImportFileContent(format, file.buffer);
    return { format, sheets: format === 'csv' ? [] : sheetList(await loadWorkbook(file.buffer)) };
}

/** The rows of a CSV file, or of the named tab of an XLSX file (needed when it has several). */
export async function readImportFile(file: ImportFileUpload, sheet?: string): Promise<ImportFileContent> {
    const format = assertImportFileType(file.originalname, file.mimetype);
    assertImportFileContent(format, file.buffer);
    if (format === 'csv') return { format, sheets: [], sheet: null, rows: readCsvRows(file.buffer), links: [] };
    const workbook = await loadWorkbook(file.buffer);
    const worksheet = selectWorksheet(workbook, sheet);
    const { ValueType } = await loadExcelJS();
    return { format, sheets: sheetList(workbook), sheet: worksheet.name, ...sheetRows(worksheet, ValueType) };
}
