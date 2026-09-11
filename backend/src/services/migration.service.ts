import { parse } from 'csv-parse/sync';
import { and, eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { suratMasuk as suratMasukTable } from '../db/schema/surat-masuk.js';
import { suratKeluar as suratKeluarTable } from '../db/schema/surat-keluar.js';
import { arsip as arsipTable } from '../db/schema/arsip.js';
import { suratMasukService } from './surat-masuk.service.js';
import { suratKeluarService } from './surat-keluar.service.js';
import { arsipService } from './arsip.service.js';
import type { CriticalAuditContext } from './audit-log.service.js';

interface ImportOptions { dryRun?: boolean }
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
}
interface CsvRow { [key: string]: string | undefined }
interface PreparedImport {
    identity: string;
    exists: () => PromiseLike<{ id: string }[]>;
    create: () => Promise<unknown>;
}
const IMPORT_ROW_LIMIT = 1_000;

function csvHeaders(headers: string[]): string[] {
    const seen = new Set<string>();
    for (const header of headers) {
        if (!header || ['__proto__', 'prototype', 'constructor'].includes(header) || seen.has(header)) {
            throw new Error('Header CSV harus unik, tidak kosong, dan tidak memakai nama properti internal.');
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
        throw new Error('Tanggal sumber "' + (source || '(kosong)') + '" tidak valid. Gunakan YYYY-MM-DD atau DD/MM/YYYY dengan tanggal kalender yang benar; tanggal tidak diganti otomatis.');
    }
    return [String(year).padStart(4, '0'), String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
}

async function runImport(
    csvContent: string,
    dateFields: string[],
    prepare: (row: CsvRow, date: string, year: number, position: number) => PreparedImport,
    options: ImportOptions,
): Promise<ImportResult> {
    const result: ImportResult = { success: true, imported: 0, skipped: 0, duplicates: 0, errors: [], dryRun: options.dryRun === true, valid: 0, rows: [] };
    try {
        const records = parse(csvContent, {
            columns: csvHeaders, bom: true, skip_empty_lines: true, trim: true,
            relax_column_count: true, max_record_size: 64 * 1024, to: IMPORT_ROW_LIMIT + 1,
        }) as CsvRow[];
        if (records.length > IMPORT_ROW_LIMIT) {
            throw new Error('Maksimal 1.000 rekod per impor. Pecah CSV menjadi beberapa berkas dan pratinjau masing-masing.');
        }
        const seen = new Set<string>();
        for (const [index, row] of records.entries()) {
            const sourceDate = dateFields.map(field => row[field]).find(value => value?.trim()) ?? '';
            const diagnostic: ImportRowResult = { row: index + 2, status: 'invalid', sourceDate };
            result.rows.push(diagnostic);
            try {
                const date = parseSourceDate(sourceDate);
                diagnostic.normalizedDate = date;
                const item = prepare(row, date, Number(date.slice(0, 4)), index + 1);
                if (seen.has(item.identity) || (await item.exists()).length > 0) {
                    diagnostic.status = 'duplicate';
                    diagnostic.message = 'Rekod dengan identitas yang sama sudah ada pada unit/tahun ini atau di berkas CSV.';
                    result.duplicates++;
                    continue;
                }
                result.valid++;
                if (!result.dryRun) {
                    // Actual import always repeats validation and duplicate checks.
                    // Preview is advisory and never grants mutation authority.
                    await item.create();
                    result.imported++;
                }
                seen.add(item.identity);
                diagnostic.status = result.dryRun ? 'valid' : 'imported';
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Rekod gagal diproses';
                diagnostic.message = message;
                result.errors.push('Row ' + diagnostic.row + ': ' + message);
                result.skipped++;
            }
        }
    } catch (error) {
        result.errors.push('Parse error: ' + (error instanceof Error ? error.message : 'CSV tidak dapat dibaca'));
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
            if (!perihal) throw new Error('Perihal wajib diisi.');
            const numbered = Boolean(nomorSurat && nomorSurat !== '-');
            if (!numbered && !dari) throw new Error('Nomor surat kosong memerlukan tanggal, perihal, dan pengirim untuk identitas impor yang stabil.');
            const identity = numbered ? [unitKerjaId, year, nomorSurat] : [unitKerjaId, date, perihal, dari];
            return {
                identity: JSON.stringify(identity),
                exists: () => db.select({ id: suratMasukTable.id }).from(suratMasukTable).where(numbered
                    ? and(eq(suratMasukTable.unitKerjaId, unitKerjaId), eq(suratMasukTable.tahun, year), eq(suratMasukTable.nomorSurat, nomorSurat))
                    : and(eq(suratMasukTable.unitKerjaId, unitKerjaId), eq(suratMasukTable.tanggalSurat, date), eq(suratMasukTable.perihal, perihal), eq(suratMasukTable.dari, dari))).limit(1),
                create: () => suratMasukService.create({
                    unitKerjaId, noUrut: parseInt(row['No'] || '0') || position, tahun: year,
                    jenisSurat: row['Jenis Surat'] || 'Surat Dinas', sifatSurat: row['Sifat Surat'] || 'Biasa',
                    nomorSurat, tanggalSurat: date, perihal, dari, kepada: row['Kepada'] || '',
                    status: row['Status'] || 'belum_dibalas', disposisi: row['Disposisi'] ? [row['Disposisi']] : [],
                    createdBy: auditContext.userId,
                }, auditContext),
            };
        }, options);
    },

    async importSuratKeluar(csvContent: string, unitKerjaId: string, auditContext: CriticalAuditContext, options: ImportOptions = {}): Promise<ImportResult> {
        return runImport(csvContent, ['Tanggal Surat'], (row, date, year) => {
            const nomorSurat = row['Nomor Surat'] || '';
            const perihal = row['Perihal'] || '';
            const kepada = row['Kepada'] || row['Tujuan'] || '';
            if (!perihal) throw new Error('Perihal wajib diisi.');
            const numbered = Boolean(nomorSurat && nomorSurat !== '-');
            if (!numbered && !kepada) throw new Error('Nomor surat kosong memerlukan tanggal, perihal, dan tujuan untuk identitas impor yang stabil.');
            return {
                identity: JSON.stringify(numbered ? [unitKerjaId, year, nomorSurat] : [unitKerjaId, date, perihal, kepada]),
                exists: () => db.select({ id: suratKeluarTable.id }).from(suratKeluarTable).where(numbered
                    ? and(eq(suratKeluarTable.unitKerjaId, unitKerjaId), eq(suratKeluarTable.tahun, year), eq(suratKeluarTable.nomorSurat, nomorSurat))
                    : and(eq(suratKeluarTable.unitKerjaId, unitKerjaId), eq(suratKeluarTable.tanggalSurat, date), eq(suratKeluarTable.perihal, perihal), eq(suratKeluarTable.kepada, kepada))).limit(1),
                create: () => suratKeluarService.create({
                    unitKerjaId, tahun: year, naskahDinas: row['Naskah Dinas'] || row['Jenis Surat'] || 'Surat Dinas',
                    numberingMode: numbered ? 'manual' : 'auto', nomorSurat: numbered ? nomorSurat : undefined,
                    tanggalSurat: date, perihal, kepada, createdBy: auditContext.userId,
                }, auditContext),
            };
        }, options);
    },

    async importArsip(csvContent: string, unitKerjaId: string, auditContext: CriticalAuditContext, options: ImportOptions = {}): Promise<ImportResult> {
        return runImport(csvContent, ['Tanggal', 'Tanggal Arsip'], (row, date, year) => {
            const uraian = row['Uraian'] || row['Uraian Berkas'] || row['Deskripsi'] || row['Perihal'] || '';
            if (!uraian) throw new Error('Uraian berkas wajib diisi.');
            const jenisArsip = row['Jenis Arsip'] || row['Jenis'] || 'masuk';
            if (!['masuk', 'keluar'].includes(jenisArsip)) throw new Error('Jenis Arsip harus masuk atau keluar.');
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
