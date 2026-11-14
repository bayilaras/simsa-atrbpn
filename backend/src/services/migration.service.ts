import { parse } from 'csv-parse/sync';
import { and, eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { arsip as arsipTable } from '../db/schema/arsip.js';
import { suratMasukService } from './surat-masuk.service.js';
import { suratKeluarService } from './surat-keluar.service.js';
import { arsipService } from './arsip.service.js';
import type { CriticalAuditContext } from './audit-log.service.js';
import { ValidationError } from '../utils/errors.js';
import { publicErrorResponse } from '../utils/public-error.js';
import { currentRequestId } from '../utils/request-context.js';
import { createLogger } from '../utils/logger.js';
import { DuplicateSuratImportError, type SuratImportIdentityKey } from './surat-import-identity.js';
import { assertImportResumable, importPrefixHash, type ImportResume } from './import-resume.js';
import { normalizeSifatSurat, sifatSuratMasukSumber } from './sifat-surat.js';
import { assertImportedKelasSuratMasuk, assertSifatSuratMasukDapatDisimpan, type ImportAuditContext } from './import-plafon-kelas.js';
import { parseImportDate } from './import-tanggal.js';

const log = createLogger('MigrationService');

interface ImportOptions {
    dryRun?: boolean;
    /** Import records from resume.startRow and start none after resume.deadlineAt. */
    resume?: ImportResume;
}
interface ImportRowResult {
    /** CSV record number, including the header as record 1. */
    row: number;
    status: 'valid' | 'imported' | 'duplicate' | 'invalid';
    sourceDate: string;
    normalizedDate?: string;
    message?: string;
}
interface ImportResult {
    success: boolean;
    imported: number;
    skipped: number;
    duplicates: number;
    errors: string[];
    dryRun: boolean;
    valid: number;
    rows: ImportRowResult[];
    /** Resumable imports only: rows and counts cover records startRow..nextRow-1 (or to the end). */
    startRow?: number;
    /** The record to continue from, or null when the file is finished. */
    nextRow?: number | null;
    /** Send back with nextRow; proves the records before it are unchanged. */
    prefixHash?: string;
}
interface CsvRow { [key: string]: string | undefined }
type PreparedImport = {
    identity: string;
    create: () => Promise<unknown>;
} & (
    /** The canonical surat identity, looked up for the whole file in one query. */
    | { key: SuratImportIdentityKey }
    /** Records without a canonical import identity are looked up one by one. */
    | { exists: () => PromiseLike<{ id: string }[]> }
);
type PreparedRecord = { diagnostic: ImportRowResult } & ({ item: PreparedImport } | { error: unknown });
const IMPORT_ROW_LIMIT = 1_000;
const MAX_RECORD_SIZE = 64 * 1024;

/** The column titles an import reads exactly; a row is read by these titles only. */
interface CsvColumns {
    /** Titles of the date column; the first one filled in a row is used. */
    date: string[];
    /** Every other column no row can be imported without, each as its accepted titles. */
    required: string[][];
}

type CsvDelimiter = ',' | ';' | '\t';
const CSV_DELIMITERS: readonly CsvDelimiter[] = [',', ';', '\t'];
const DELIMITER_NAMES: Record<CsvDelimiter, string> = { ',': 'koma (,)', ';': 'titik koma (;)', '\t': 'tab' };

/**
 * The separator of the header line. Excel writes CSV with the list separator
 * of the regional settings, which is ";" in Indonesia. The separator used
 * most outside quotes in the header line wins and a tie keeps ","; commas in
 * the descriptions below never outvote it.
 */
function headerDelimiter(text: string): CsvDelimiter {
    const counts = new Map<string, number>(CSV_DELIMITERS.map(delimiter => [delimiter, 0]));
    let quoted = false;
    for (let i = 0; i < text.length && i < MAX_RECORD_SIZE; i++) {
        const char = text[i];
        if (char === '"') quoted = !quoted;
        else if (!quoted && (char === '\n' || char === '\r')) break;
        else if (!quoted && counts.has(char)) counts.set(char, counts.get(char)! + 1);
    }
    return CSV_DELIMITERS.reduce((best, delimiter) => counts.get(delimiter)! > counts.get(best)! ? delimiter : best);
}

/** "A atau B", "A, B, atau C". */
function alternatives(titles: string[]): string {
    return titles.length < 3 ? titles.join(' atau ') : `${titles.slice(0, -1).join(', ')}, atau ${titles.at(-1)}`;
}

function csvHeaders(headers: string[]): string[] {
    const seen = new Set<string>();
    for (const header of headers) {
        if (!header || ['__proto__', 'prototype', 'constructor'].includes(header) || seen.has(header)) {
            throw new ValidationError('Header CSV harus unik, tidak kosong, dan tidak memakai nama properti internal.');
        }
        seen.add(header);
    }
    return headers;
}

/** The calendar date of a row, read like the surat imports read it (see import-tanggal). */
function sourceDate(value: string): string {
    const date = parseImportDate(value);
    if (!date) throw new ValidationError('Tanggal wajib diisi.');
    return date;
}

async function runImport(
    csvContent: string,
    columns: CsvColumns,
    prepare: (row: CsvRow, date: string, year: number, position: number) => PreparedImport,
    options: ImportOptions,
    existingSurat?: (keys: SuratImportIdentityKey[]) => Promise<boolean[]>,
): Promise<ImportResult> {
    const result: ImportResult = { success: true, imported: 0, skipped: 0, duplicates: 0, errors: [], dryRun: options.dryRun === true, valid: 0, rows: [] };
    const delimiter = headerDelimiter(csvContent);
    let headers: string[] = [];
    let records: CsvRow[];
    try {
        records = parse(csvContent, {
            columns: (titles: string[]) => (headers = csvHeaders(titles)), delimiter, bom: true, skip_empty_lines: true, trim: true,
            relax_column_count: true, max_record_size: MAX_RECORD_SIZE, to: IMPORT_ROW_LIMIT + 1,
        }) as CsvRow[];
        if (records.length > IMPORT_ROW_LIMIT) {
            throw new ValidationError('Maksimal 1.000 rekod per impor. Pecah CSV menjadi beberapa berkas dan pratinjau masing-masing.');
        }
    } catch (error) {
        const failure = publicErrorResponse(error, currentRequestId());
        log.warn({ event: 'csv_import_parse_rejected', publicCode: failure.code }, 'CSV import rejected');
        result.errors.push(error instanceof ValidationError ? failure.message
            : `CSV tidak dapat dibaca dengan pemisah ${DELIMITER_NAMES[delimiter]}. Periksa format dan panjang baris.`);
        result.success = false;
        return result;
    }
    // Without a required column every row would fail on its first missing
    // value; name the columns instead, with the separator the header was read with.
    const missing = [columns.date, ...columns.required].filter(titles => !titles.some(title => headers.includes(title)));
    if (missing.length) {
        log.warn({ event: 'csv_import_columns_missing', missing: missing.length }, 'CSV import rejected');
        result.errors.push(`Kolom wajib tidak ditemukan di baris judul: ${missing.map(alternatives).join('; ')}. `
            + `Pemisah kolom yang terbaca: ${DELIMITER_NAMES[delimiter]}. Periksa judul kolom pada baris pertama CSV.`);
        result.success = false;
        return result;
    }
    const { resume } = options;
    const start = resume?.startRow ?? 0;
    if (resume) assertImportResumable(records, resume);
    const prepared = records.slice(start).map((row, offset): PreparedRecord => {
        const index = start + offset;
        const sourceValue = columns.date.map(field => row[field]).find(value => value?.trim()) ?? '';
        const diagnostic: ImportRowResult = { row: index + 2, status: 'invalid', sourceDate: sourceValue };
        try {
            const date = sourceDate(sourceValue);
            diagnostic.normalizedDate = date;
            return { diagnostic, item: prepare(row, date, Number(date.slice(0, 4)), index + 1) };
        } catch (error) { return { diagnostic, error }; }
    });
    // One advisory lookup for every surat in the file; the canonical transaction repeats it under the unit lock.
    const keyed = prepared.flatMap(entry => 'item' in entry && 'key' in entry.item ? [{ entry, key: entry.item.key }] : []);
    const found = keyed.length && existingSurat ? await existingSurat(keyed.map(({ key }) => key)) : [];
    const recorded = new Set(keyed.flatMap(({ entry }, index) => found[index] ? [entry] : []));
    const seen = new Set<string>();
    for (const [offset, entry] of prepared.entries()) {
        // Every part handles at least one record, so a continuation always advances.
        if (resume && offset > 0 && Date.now() >= resume.deadlineAt) { result.nextRow = start + offset; break; }
        const { diagnostic } = entry;
        result.rows.push(diagnostic);
        try {
            if ('error' in entry) throw entry.error;
            const { item } = entry;
            if (seen.has(item.identity) || recorded.has(entry) || ('exists' in item && (await item.exists()).length > 0)) {
                diagnostic.status = 'duplicate';
                diagnostic.message = 'Rekod dengan identitas yang sama sudah ada pada unit/tahun ini atau di berkas CSV.';
                result.duplicates++;
                continue;
            }
            result.valid++;
            if (!result.dryRun) {
                // Actual import always repeats validation and duplicate checks.
                // Preview is advisory and never grants mutation authority.
                try {
                    await item.create();
                } catch (error) {
                    if (!(error instanceof DuplicateSuratImportError)) throw error;
                    // Another importer may commit after the advisory lookup.
                    // The canonical transaction checks again under the unit lock.
                    diagnostic.status = 'duplicate';
                    diagnostic.message = 'Rekod dengan identitas yang sama sudah ada pada unit/tahun ini atau di berkas CSV.';
                    result.duplicates++;
                    result.valid--;
                    seen.add(item.identity);
                    continue;
                }
                result.imported++;
            }
            seen.add(item.identity);
            diagnostic.status = result.dryRun ? 'valid' : 'imported';
        } catch (error) {
            const failure = publicErrorResponse(error, currentRequestId());
            log.warn({ event: 'csv_import_row_rejected', row: diagnostic.row, publicCode: failure.code }, 'Import row rejected');
            const message = failure.message;
            diagnostic.message = message;
            result.errors.push('Baris ' + diagnostic.row + ': ' + message);
            result.skipped++;
        }
    }
    if (resume) {
        result.startRow = start;
        result.nextRow ??= null;
        if (result.nextRow !== null) result.prefixHash = importPrefixHash(records, result.nextRow);
    }
    result.success = result.errors.length === 0;
    return result;
}

const SURAT_COLUMNS: CsvColumns = { date: ['Tanggal Surat'], required: [['Perihal']] };
const URAIAN_TITLES = ['Uraian', 'Uraian Berkas', 'Deskripsi', 'Perihal'];
const ARSIP_COLUMNS: CsvColumns = { date: ['Tanggal', 'Tanggal Arsip'], required: [URAIAN_TITLES] };

export const migrationService = {
    async importSuratMasuk(csvContent: string, unitKerjaId: string, auditContext: ImportAuditContext, options: ImportOptions = {}): Promise<ImportResult> {
        return runImport(csvContent, SURAT_COLUMNS, (row, date, year, position) => {
            const sifatSurat = sifatSuratMasukSumber(row['Sifat Surat']);
            // A class above the importer's ceiling, or a sifat that names no
            // class, makes the row invalid, in a dry run too. This path has no
            // sinkron, so every row it accepts is a new letter.
            assertImportedKelasSuratMasuk(auditContext, sifatSurat);
            assertSifatSuratMasukDapatDisimpan(sifatSurat);
            const nomorSurat = row['Nomor Surat'] || '';
            const perihal = row['Perihal'] || '';
            const dari = row['Dari'] || '';
            if (!perihal) throw new ValidationError('Perihal wajib diisi.');
            const numbered = Boolean(nomorSurat && nomorSurat !== '-');
            if (!numbered && !dari) throw new ValidationError('Nomor surat kosong memerlukan tanggal, perihal, dan pengirim untuk identitas impor yang stabil.');
            const identity = numbered ? [unitKerjaId, year, nomorSurat] : [unitKerjaId, date, perihal, dari];
            const record = {
                unitKerjaId, noUrut: parseInt(row['No'] || '0') || position, tahun: year,
                jenisSurat: row['Jenis Surat'] || 'Surat Dinas', sifatSurat,
                nomorSurat, tanggalSurat: date, perihal, dari, kepada: row['Kepada'] || '',
                status: row['Status'] || 'belum_dibalas', disposisi: row['Disposisi'] ? [row['Disposisi']] : [],
                createdBy: auditContext.userId,
            };
            return {
                identity: JSON.stringify(identity),
                key: suratMasukService.importIdentityKey(record),
                create: () => suratMasukService.createImported(record, auditContext),
            };
        }, options, keys => suratMasukService.existingImportIdentities(keys));
    },

    async importSuratKeluar(csvContent: string, unitKerjaId: string, auditContext: CriticalAuditContext, options: ImportOptions = {}): Promise<ImportResult> {
        return runImport(csvContent, SURAT_COLUMNS, (row, date, year) => {
            const nomorSurat = row['Nomor Surat'] || '';
            const perihal = row['Perihal'] || '';
            const kepada = row['Kepada'] || row['Tujuan'] || '';
            if (!perihal) throw new ValidationError('Perihal wajib diisi.');
            const numbered = Boolean(nomorSurat && nomorSurat !== '-');
            if (!numbered && !kepada) throw new ValidationError('Nomor surat kosong memerlukan tanggal, perihal, dan tujuan untuk identitas impor yang stabil.');
            const record = {
                unitKerjaId, tahun: year, naskahDinas: row['Naskah Dinas'] || row['Jenis Surat'] || 'Surat Dinas',
                sifatSurat: normalizeSifatSurat(row['Sifat Surat']),
                numberingMode: numbered ? 'manual' as const : 'auto' as const, nomorSurat: numbered ? nomorSurat : undefined,
                tanggalSurat: date, perihal, kepada, createdBy: auditContext.userId,
            };
            return {
                identity: JSON.stringify(numbered ? [unitKerjaId, year, nomorSurat] : [unitKerjaId, date, perihal, kepada]),
                key: suratKeluarService.importIdentityKey(record),
                create: () => suratKeluarService.createImported(record, auditContext),
            };
        }, options, keys => suratKeluarService.existingImportIdentities(keys));
    },

    async importArsip(csvContent: string, unitKerjaId: string, auditContext: CriticalAuditContext, options: ImportOptions = {}): Promise<ImportResult> {
        return runImport(csvContent, ARSIP_COLUMNS, (row, date, year) => {
            const uraian = URAIAN_TITLES.map(title => row[title]).find(Boolean) || '';
            if (!uraian) throw new ValidationError('Uraian berkas wajib diisi.');
            const jenisArsip = row['Jenis Arsip'] || row['Jenis'] || 'masuk';
            if (!['masuk', 'keluar'].includes(jenisArsip)) throw new ValidationError('Jenis Arsip harus masuk atau keluar.');
            const nomorBerkas = row['Nomor Berkas'] || row['No'] || '';
            const numbered = Boolean(nomorBerkas && nomorBerkas !== '-');
            const legacyCode = row['Kode Klasifikasi'] || row['Kode'] || '';
            const legacyNotes = [row['Keterangan'] || '', legacyCode ? 'Kode klasifikasi sumber (belum diverifikasi): ' + legacyCode : ''].filter(Boolean).join('\n');
            return {
                identity: JSON.stringify(numbered ? [unitKerjaId, year, nomorBerkas] : [unitKerjaId, date, uraian, jenisArsip]),
                exists: () => db.select({ id: arsipTable.id }).from(arsipTable).where(numbered
                    ? and(eq(arsipTable.unitKerjaId, unitKerjaId), eq(arsipTable.tahun, year), eq(arsipTable.nomorBerkas, nomorBerkas))
                    : and(eq(arsipTable.unitKerjaId, unitKerjaId), eq(arsipTable.tanggalArsip, date), eq(arsipTable.uraianBerkas, uraian), eq(arsipTable.jenisArsip, jenisArsip))).limit(1),
                // Legacy display codes remain notes; rule assignment still needs reconciliation.
                create: () => arsipService.create({
                    unitKerjaId, jenisArsip, tahun: year, nomorBerkas, uraianBerkas: uraian,
                    tingkatPerkembangan: row['Tingkat Perkembangan'] || '', tanggalArsip: date,
                    kurunWaktu: row['Kurun'] || row['Kurun Waktu'] || '', jumlah: parseInt(row['Jumlah'] || '1') || 1,
                    keterangan: legacyNotes, createdBy: auditContext.userId,
                }, auditContext),
            };
        }, options);
    },
};
