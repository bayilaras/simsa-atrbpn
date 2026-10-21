import { describe, expect, it } from 'vitest';
import { PayloadTooLargeError, ValidationError } from '../utils/errors.js';
import {
    IMPORT_FILE_LIMITS, assertImportFileType, listImportFileSheets, readImportFile, unpackXlsx,
} from '../services/import-file-reader.js';
import { REGISTER_HEADERS, XLSX_MIME, driveLink, registerWorkbook, repackage, singleSheetWorkbook, upload, zipArchive } from './helpers/import-file-fixtures.js';

const csv = (text: string | Buffer, name = 'register.csv', mime = 'text/csv') =>
    upload(Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8'), name, mime);

describe('XLSX import files', () => {
    it('lists the tabs in workbook order and marks hidden ones', async () => {
        expect(await listImportFileSheets(upload(await registerWorkbook()))).toEqual({
            format: 'xlsx',
            sheets: [{ name: '2026', hidden: false }, { name: '2025', hidden: false }, { name: 'Rekap', hidden: true }],
        });
    });

    it('reads the chosen tab as the rows a Google Sheets CSV export would give', async () => {
        const content = await readImportFile(upload(await registerWorkbook()), '2026');
        expect(content).toMatchObject({ format: 'xlsx', sheet: '2026' });
        expect(content.rows).toEqual([
            // A merged title keeps its text in the first cell only.
            ['REGISTER SURAT KELUAR 2026'],
            REGISTER_HEADERS,
            // Dates (with or without a time) become YYYY-MM-DD; empty cells inside a row stay empty.
            ['1', '87/SK-600/I/2026', '2026-01-05', '2026-01-05', 'Tim peneliti', 'Segera', 'Halaman Ke 3', '', driveLink('a')],
            // A bare Excel serial with a date format, and a hyperlink cell read as its URL.
            ['2', '88/SK-600/I/2026', '2026-01-06', '', 'Undangan rapat', 'Biasa', 'Halaman Ke 1', 'file', driveLink('b')],
            // A formula is read as its cached result. Formatted empty rows are not rows.
            ['3', '-', '2026-01-07', '', 'Nota dinas tanpa nomor', 'Penting', '', 'file', driveLink('c')],
        ]);
    });

    it('needs a tab choice when the workbook has several, and never guesses an unknown one', async () => {
        const file = upload(await registerWorkbook());
        await expect(readImportFile(file)).rejects.toThrow('Pilih lembar kerja');
        await expect(readImportFile(file, '2024')).rejects.toThrow('Lembar kerja "2024" tidak ditemukan');
        expect((await readImportFile(file, 'Rekap')).rows).toEqual([['Jumlah', '3']]);
        const single = upload(await singleSheetWorkbook(sheet => sheet.addRow(['a'])));
        expect(await readImportFile(single)).toMatchObject({ sheet: 'Data', rows: [['a']] });
    });

    it('reads the target of a HYPERLINK formula and text of rich text, booleans and errors', async () => {
        const file = upload(await singleSheetWorkbook(sheet => {
            sheet.addRow([
                { formula: `HYPERLINK("${driveLink('h')}","buka")`, result: 'buka' },
                { richText: [{ text: 'Surat ' }, { font: { bold: true }, text: 'penting' }] },
                true,
                { error: '#N/A' },
                { formula: 'HYPERLINK("#Rekap!A1","lokal")', result: 'lokal' },
                { text: 'surel', hyperlink: 'mailto:tu@example.test' },
            ]);
        }));
        expect((await readImportFile(file)).rows).toEqual([[driveLink('h'), 'Surat penting', 'TRUE', '#N/A', 'lokal', 'surel']]);
    });

    it('accepts 1,005 filled rows and rejects one more', async () => {
        const rows = (count: number) => singleSheetWorkbook(sheet => { for (let i = 1; i <= count; i++) sheet.addRow([i]); });
        expect((await readImportFile(upload(await rows(IMPORT_FILE_LIMITS.rows)))).rows).toHaveLength(1_005);
        await expect(readImportFile(upload(await rows(IMPORT_FILE_LIMITS.rows + 1)))).rejects.toThrow(PayloadTooLargeError);
    });

    it('rejects a value beyond 64 columns and a cell over 16 KiB, but not empty formatting', async () => {
        const wide = upload(await singleSheetWorkbook(sheet => { sheet.getCell(1, 65).value = 'catatan'; }));
        await expect(readImportFile(wide)).rejects.toThrow('64 kolom');
        const formatted = upload(await singleSheetWorkbook(sheet => { sheet.getCell(1, 1).value = 'a'; sheet.getCell(1, 200).numFmt = '@'; }));
        expect((await readImportFile(formatted)).rows).toEqual([['a']]);
        const long = upload(await singleSheetWorkbook(sheet => { sheet.getCell(1, 1).value = 'x'.repeat(16 * 1024 + 1); }));
        await expect(readImportFile(long)).rejects.toThrow('16 KiB');
    });

    it('skips data validations instead of expanding a whole-sheet range', async () => {
        const parts = unpackXlsx(await singleSheetWorkbook(sheet => sheet.addRow(['Nomor Surat'])));
        const sheetXml = parts.get('xl/worksheets/sheet1.xml')!.toString('utf8').replace('</sheetData>',
            '</sheetData><dataValidations count="1"><dataValidation type="list" allowBlank="1" sqref="A1:XFD1048576"><formula1>"a,b"</formula1></dataValidation></dataValidations>');
        const file = upload(repackage(parts, { 'xl/worksheets/sheet1.xml': sheetXml }));
        expect((await readImportFile(file)).rows).toEqual([['Nomor Surat']]);
    }, 10_000);
});

describe('XLSX packages are checked before exceljs reads them', () => {
    const parts = async () => unpackXlsx(await singleSheetWorkbook(sheet => sheet.addRow(['a'])));

    it('rejects an encrypted workbook or an old .xls saved under .xlsx', async () => {
        const ole = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(512)]);
        await expect(readImportFile(upload(ole))).rejects.toThrow('kata sandi');
    });

    it.each([
        ['a VBA project', { 'xl/vbaProject.bin': Buffer.from('macro') }],
        ['an Excel 4.0 macro sheet', { 'xl/macrosheets/sheet1.xml': '<xm:macrosheet/>' }],
    ])('rejects a workbook containing %s', async (_case, changes) => {
        await expect(readImportFile(upload(repackage(await parts(), changes)))).rejects.toThrow('makro');
    });

    it.each([
        ['application/vnd.ms-excel.sheet.macroEnabled.main+xml', 'makro'],
        ['application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml', 'templat'],
    ])('rejects the workbook content type %s', async (type, message) => {
        const original = (await parts()).get('[Content_Types].xml')!.toString('utf8');
        const types = original.replace('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', type);
        await expect(readImportFile(upload(repackage(await parts(), { '[Content_Types].xml': types })))).rejects.toThrow(message);
    });

    it('rejects a package without a workbook', async () => {
        await expect(readImportFile(upload(repackage(await parts(), { 'xl/workbook.xml': null })))).rejects.toThrow('bukan buku kerja XLSX');
    });

    it('rejects encrypted entries and unsupported compression', async () => {
        await expect(readImportFile(upload(zipArchive([{ name: '[Content_Types].xml', data: 'x', flags: 1 }])))).rejects.toThrow(ValidationError);
        const bzip = zipArchive([{ name: '[Content_Types].xml', data: 'x', store: true }]);
        bzip.writeUInt16LE(12, 8); bzip.writeUInt16LE(12, bzip.indexOf(Buffer.from('504b0102', 'hex')) + 10);
        await expect(readImportFile(upload(bzip))).rejects.toThrow(ValidationError);
    });

    it('rejects a central directory that does not end at the end record', async () => {
        const archive = zipArchive([...await parts()].map(([name, data]) => ({ name, data })));
        const end = archive.length - 22;
        // Shifting the declared directory leaves a gap JSZip would "correct" by moving every offset.
        const shifted = Buffer.from(archive);
        shifted.writeUInt32LE(archive.readUInt32LE(end + 16) - 4, end + 16);
        await expect(readImportFile(upload(shifted))).rejects.toThrow('bukan XLSX');
        // An entry hidden after the declared count.
        const undercounted = Buffer.from(archive);
        undercounted.writeUInt16LE(archive.readUInt16LE(end + 8) - 1, end + 8);
        undercounted.writeUInt16LE(archive.readUInt16LE(end + 10) - 1, end + 10);
        await expect(readImportFile(upload(undercounted))).rejects.toThrow('bukan XLSX');
    });

    it('rejects a part that inflates beyond its declared size', async () => {
        const lying = zipArchive([...await parts()].map(([name, data]) => ({ name, data }))
            .concat({ name: 'xl/media/image1.png', data: Buffer.alloc(8 * 1024 * 1024), declaredSize: 1024 }));
        await expect(readImportFile(upload(lying))).rejects.toThrow(ValidationError);
    });

    it('rejects a package that unpacks beyond the limit or has too many parts or tabs', async () => {
        const big = repackage(await parts(), { 'xl/media/image1.png': Buffer.alloc(IMPORT_FILE_LIMITS.unpackedBytes + 1) });
        await expect(readImportFile(upload(big))).rejects.toThrow(PayloadTooLargeError);
        const many = Object.fromEntries(Array.from({ length: IMPORT_FILE_LIMITS.zipEntries }, (_v, i) => [`docProps/custom${i}.xml`, '<x/>']));
        await expect(readImportFile(upload(repackage(await parts(), many)))).rejects.toThrow(PayloadTooLargeError);
        const tabs = Object.fromEntries(Array.from({ length: IMPORT_FILE_LIMITS.sheets }, (_v, i) => [`xl/worksheets/sheet${i + 2}.xml`, '<worksheet/>']));
        await expect(readImportFile(upload(repackage(await parts(), tabs)))).rejects.toThrow('100 lembar');
    });

    it('rejects a file that is not a ZIP package or not readable as a workbook', async () => {
        await expect(readImportFile(upload(Buffer.from('Nomor Surat,Hal\n1,a')))).rejects.toThrow('bukan XLSX');
        const broken = repackage(await parts(), { 'xl/workbook.xml': '<workbook' });
        await expect(readImportFile(upload(broken))).rejects.toThrow(ValidationError);
    });
});

describe('CSV import files', () => {
    it('reads a comma-separated UTF-8 file with a byte order mark', async () => {
        const content = await readImportFile(csv('﻿Nomor Surat,Hal\n"1/A","Rapat, koordinasi"\n'));
        expect(content).toEqual({ format: 'csv', sheets: [], sheet: null, rows: [['Nomor Surat', 'Hal'], ['1/A', 'Rapat, koordinasi']] });
    });

    it('reads the semicolon list separator Excel uses in Indonesian regional settings', async () => {
        const text = [
            'REGISTER SURAT KELUAR 2026;;;;;;;;',
            REGISTER_HEADERS.join(';'),
            `1;87/SK-600/I/2026;05/01/2026;05/01/2026 15:12;Tim peneliti, tahap 1;Segera;Halaman Ke 3;;${driveLink('a')}`,
        ].join('\r\n');
        expect((await readImportFile(csv(text))).rows).toEqual([
            ['REGISTER SURAT KELUAR 2026', '', '', '', '', '', '', '', ''],
            REGISTER_HEADERS,
            ['1', '87/SK-600/I/2026', '05/01/2026', '05/01/2026 15:12', 'Tim peneliti, tahap 1', 'Segera', 'Halaman Ke 3', '', driveLink('a')],
        ]);
    });

    it('reads a tab-separated file', async () => {
        expect((await readImportFile(csv('Nomor Surat\tHal\n1/A\tRapat, koordinasi'))).rows).toEqual([['Nomor Surat', 'Hal'], ['1/A', 'Rapat, koordinasi']]);
    });

    it('reads a Windows-1252 file saved as plain "CSV (Comma delimited)"', async () => {
        const bytes = Buffer.concat([Buffer.from('Nomor Surat;Hal\n1/A;Rapat '), Buffer.from([0x96]), Buffer.from(' tahap 2')]);
        expect((await readImportFile(csv(bytes))).rows[1]).toEqual(['1/A', 'Rapat – tahap 2']);
    });

    it('rejects binary content and a workbook saved with a .csv name', async () => {
        await expect(readImportFile(csv(Buffer.from('N\u0000o\u0000', 'latin1')))).rejects.toThrow('CSV UTF-8');
        await expect(readImportFile(csv(await registerWorkbook()))).rejects.toThrow('.xlsx');
    });

    it('applies the row limit of the Google Sheets import', async () => {
        const rows = ['Nomor Surat,Hal', ...Array.from({ length: IMPORT_FILE_LIMITS.rows }, (_v, i) => `${i},a`)].join('\n');
        await expect(readImportFile(csv(rows))).rejects.toThrow(PayloadTooLargeError);
    });
});

describe('import file type', () => {
    it.each([
        ['register.csv', 'text/csv', 'csv'], ['REGISTER.CSV', 'application/vnd.ms-excel', 'csv'], ['register.csv', 'text/plain', 'csv'],
        ['register.xlsx', XLSX_MIME, 'xlsx'], ['register.xlsx', 'application/octet-stream', 'xlsx'], ['register.xlsx', 'application/x-zip-compressed', 'xlsx'],
    ])('accepts %s sent as %s', (name, mime, format) => {
        expect(assertImportFileType(name, mime)).toBe(format);
    });

    it.each([
        ['register.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12'], ['register.xls', 'application/vnd.ms-excel'],
        ['register.ods', 'application/vnd.oasis.opendocument.spreadsheet'], ['register.xlsx', 'text/csv'],
        ['register.csv', XLSX_MIME], ['register.xlsx.exe', 'application/octet-stream'],
    ])('rejects %s sent as %s', (name, mime) => {
        expect(() => assertImportFileType(name, mime)).toThrow(ValidationError);
    });

    it('rejects an empty or oversized file before reading it', async () => {
        await expect(readImportFile(csv(Buffer.alloc(0)))).rejects.toThrow('kosong');
        await expect(readImportFile(csv(Buffer.alloc(IMPORT_FILE_LIMITS.bytes + 1, 0x61)))).rejects.toThrow(PayloadTooLargeError);
    });
});
