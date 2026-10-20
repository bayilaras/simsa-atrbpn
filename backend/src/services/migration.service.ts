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
import { normalizeSifatSurat } from './sifat-surat.js';

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

/** Validate the source calendar date without timezone conversion or rollover. */
function parseSourceDate(source: string): string {
    const value = source.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const local = /^(\d{2})\/(\d{2})\/(\d{4})(?: ([01]\d|2[0-3]):([0-5]\d):([0-5]\d))?$/.exec(value);
    const year = Number(iso?.[1] ?? local?.[3]);
    const month = Number(iso?.[2] ?? local?.[2]);
    const day = Number(iso?.[3] ?? local?.[1]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if ((!iso && !local) || year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
        throw new ValidationError('Tanggal sumber "' + (source || '(kosong)') + '" tidak valid. Gunakan YYYY-MM-DD atau DD/MM/YYYY dengan tanggal kalender yang benar; tanggal tidak diganti otomatis.');
    }
    return [String(year).padStart(4, '0'), String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
}

async function runImport(
    csvContent: string,
    dateFields: string[],
    prepare: (row: CsvRow, date: string, year: number, position: number) => PreparedImport,
    options: ImportOptions,
    existingSurat?: (keys: SuratImportIdentityKey[]) => Promise<boolean[]>,
): Promise<ImportResult> {
    const result: ImportResult = { success: true, imported: 0, skipped: 0, duplicates: 0, errors: [], dryRun: options.dryRun === true, valid: 0, rows: [] };
    let records: CsvRow[];
    try {
        records = parse(csvContent, {
            columns: csvHeaders, bom: true, skip_empty_lines: true, trim: true,
            relax_column_count: true, max_record_size: 64 * 1024, to: IMPORT_ROW_LIMIT + 1,
        }) as CsvRow[];
        if (records.length > IMPORT_ROW_LIMIT) {
            throw new ValidationError('Maksimal 1.000 rekod per impor. Pecah CSV menjadi beberapa berkas dan pratinjau masing-masing.');
        }
    } catch (error) {
        const failure = publicErrorResponse(error, currentRequestId());
        log.warn({ event: 'csv_import_parse_rejected', publicCode: failure.code }, 'CSV import rejected');
        result.errors.push('Parse error: ' + (error instanceof ValidationError ? failure.message : 'CSV tidak dapat dibaca. Periksa format dan panjang baris.'));
        result.success = false;
        return result;
    }
    const { resume } = options;
    const start = resume?.startRow ?? 0;
    if (resume) assertImportResumable(records, resume);
    const prepared = records.slice(start).map((row, offset): PreparedRecord => {
        const index = start + offset;
        const sourceDate = dateFields.map(field => row[field]).find(value => value?.trim()) ?? '';
        const diagnostic: ImportRowResult = { row: index + 2, status: 'invalid', sourceDate };
        try {
            const date = parseSourceDate(sourceDate);
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
            result.errors.push('Row ' + diagnostic.row + ': ' + message);
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

export const migrationService = {
    async importSuratMasuk(csvContent: string, unitKerjaId: string, auditContext: CriticalAuditContext, options: ImportOptions = {}): Promise<ImportResult> {
        return runImport(csvContent, ['Tanggal Surat'], (row, date, year, position) => {
            const nomorSurat = row['Nomor Surat'] || '';
            const perihal = row['Perihal'] || '';
            const dari = row['Dari'] || '';
            if (!perihal) throw new ValidationError('Perihal wajib diisi.');
            const numbered = Boolean(nomorSurat && nomorSurat !== '-');
            if (!numbered && !dari) throw new ValidationError('Nomor surat kosong memerlukan tanggal, perihal, dan pengirim untuk identitas impor yang stabil.');
            const identity = numbered ? [unitKerjaId, year, nomorSurat] : [unitKerjaId, date, perihal, dari];
            const record = {
                unitKerjaId, noUrut: parseInt(row['No'] || '0') || position, tahun: year,
                jenisSurat: row['Jenis Surat'] || 'Surat Dinas', sifatSurat: row['Sifat Surat'] || 'Biasa',
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
        return runImport(csvContent, ['Tanggal Surat'], (row, date, year) => {
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
        return runImport(csvContent, ['Tanggal', 'Tanggal Arsip'], (row, date, year) => {
            const uraian = row['Uraian'] || row['Uraian Berkas'] || row['Deskripsi'] || row['Perihal'] || '';
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
