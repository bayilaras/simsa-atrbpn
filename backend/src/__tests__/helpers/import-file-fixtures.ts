import { crc32, deflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';

/** Synthetic sources shaped like the outgoing-letter register (no real letters or links). */
export const REGISTER_HEADERS = ['SURAT KELUAR 2026 No', 'Nomor Surat', 'Tanggal Surat', 'Tanggal TTE', 'Hal', 'Sifat Surat', 'Posisi', 'Get link', 'Get link'];
export const driveLink = (id: string) => `https://drive.google.com/file/d/synthetic-${id}/view`;
const utc = (year: number, month: number, day: number, hour = 0, minute = 0) => new Date(Date.UTC(year, month - 1, day, hour, minute));

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const upload = (buffer: Buffer, originalname = 'register.xlsx', mimetype = XLSX_MIME) => ({ originalname, mimetype, buffer });

/**
 * Tab "2026" as Excel or a Google Sheets download stores it: a merged title,
 * date cells (Excel serials with a date format), a hyperlink cell, a formula
 * with its cached result, and two "Get link" columns of which only the last
 * holds URLs. "2025" is a second tab and "Rekap" a hidden one.
 */
export async function registerWorkbook(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('2026');
    sheet.addRow(['REGISTER SURAT KELUAR 2026']);
    sheet.mergeCells('A1:I1');
    sheet.addRow(REGISTER_HEADERS);
    sheet.addRow([1, '87/SK-600/I/2026', utc(2026, 1, 5), utc(2026, 1, 5, 15, 12), 'Tim peneliti', 'Segera', 'Halaman Ke 3', null, driveLink('a')]);
    // A bare serial with a date format, a label column and a hyperlink cell whose text is not the URL.
    sheet.addRow([2, '88/SK-600/I/2026', 46028, null, 'Undangan rapat', 'Biasa', 'Halaman Ke 1', 'file', { text: 'Lihat berkas', hyperlink: driveLink('b') }]);
    sheet.addRow([{ formula: 'A4+1', result: 3 }, '-', utc(2026, 1, 7), null, 'Nota dinas tanpa nomor', 'Penting', null, 'file', driveLink('c')]);
    sheet.getColumn(3).numFmt = 'dd/mm/yyyy';
    sheet.getCell('C4').numFmt = 'd mmmm yyyy';
    sheet.getColumn(4).numFmt = 'dd/mm/yyyy hh:mm';
    // Empty rows that only carry formatting, as spreadsheet downloads often have.
    for (let row = 6; row <= 400; row++) sheet.getCell(`F${row}`).numFmt = '@';

    const previous = workbook.addWorksheet('2025');
    previous.addRow(['No', 'Nomor Surat', 'Tanggal Surat', 'Hal', 'Kepada']);
    previous.addRow([1, '10/SK/XII/2025', utc(2025, 12, 1), 'Laporan akhir', 'Sekretariat']);
    workbook.addWorksheet('Rekap', { state: 'hidden' }).addRow(['Jumlah', 3]);
    return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** One worksheet built by `fill`. */
export async function singleSheetWorkbook(fill: (sheet: ExcelJS.Worksheet) => void, name = 'Data'): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    fill(workbook.addWorksheet(name));
    return Buffer.from(await workbook.xlsx.writeBuffer());
}

export interface ZipPart {
    name: string;
    data: Buffer | string;
    store?: boolean;
    /** The uncompressed size the archive claims, when it should lie. */
    declaredSize?: number;
    flags?: number;
    /** Central-directory extra fields. */
    extra?: Buffer;
}

/** A minimal ZIP writer, so tests can build packages a spreadsheet program would never write. */
export function zipArchive(parts: ZipPart[]): Buffer {
    const records: Buffer[] = [];
    const directory: Buffer[] = [];
    let offset = 0;
    for (const part of parts) {
        const data = Buffer.isBuffer(part.data) ? part.data : Buffer.from(part.data, 'utf8');
        const body = part.store ? data : deflateRawSync(data);
        const name = Buffer.from(part.name, 'utf8');
        const method = part.store ? 0 : 8;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(part.flags ?? 0, 6);
        local.writeUInt16LE(method, 8); local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(part.declaredSize ?? data.length, 22); local.writeUInt16LE(name.length, 26);
        const extra = part.extra ?? Buffer.alloc(0);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
        central.writeUInt16LE(part.flags ?? 0, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc32(data), 16);
        central.writeUInt32LE(body.length, 20); central.writeUInt32LE(part.declaredSize ?? data.length, 24);
        central.writeUInt16LE(name.length, 28); central.writeUInt16LE(extra.length, 30); central.writeUInt32LE(offset, 42);
        records.push(local, name, body);
        directory.push(central, name, extra);
        offset += local.length + name.length + body.length;
    }
    const centralDirectory = Buffer.concat(directory);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...records, centralDirectory, end]);
}

/** Rebuild an XLSX with some parts replaced, added or removed (null). */
export function repackage(parts: Map<string, Buffer>, changes: Record<string, Buffer | string | null>): Buffer {
    const next = new Map<string, Buffer | string>(parts);
    for (const [name, data] of Object.entries(changes)) {
        if (data === null) next.delete(name); else next.set(name, data);
    }
    return zipArchive([...next].map(([name, data]) => ({ name, data })));
}
