import { type NewSuratMasuk } from '../db/schema/surat-masuk';
import { type NewSuratKeluar } from '../db/schema/surat-keluar';
import { createLogger } from '../utils/logger';
import { suratMasukService } from './surat-masuk.service.js';
import { suratKeluarService } from './surat-keluar.service.js';
import type { CriticalAuditContext } from './audit-log.service.js';
import { AppError, PayloadTooLargeError, ValidationError } from '../utils/errors.js';
import { publicErrorResponse } from '../utils/public-error.js';
import { currentRequestId } from '../utils/request-context.js';
import { GOOGLE_SHEETS_LIMITS, GoogleSheetsAccessError, GoogleSheetsSource, assertSheetName, assertSpreadsheetId, parseBoundedSheetCsv, parseSheetTabs, type GoogleSheetsRequestOptions, type SheetTab } from './google-sheets-source.js';

import { isWebAddress, resolveSheetMapping, type GoogleSheetsImportType, type SheetColumnMapping } from './google-sheets-import-mapping.js';
import { DuplicateSuratImportError, type SuratImportIdentityKey, type SuratImportMatch } from './surat-import-identity.js';
import { assertImportResumable, importPrefixHash, type ImportResume } from './import-resume.js';
import { normalizeSifatSurat } from './sifat-surat.js';
import {
    syncImportedLetter, syncSourceText, type ImportCounterpart, type ImportFieldChange, type ImportSync, type ImportSyncTarget,
} from './import-sync.js';
import { updateSuratKeluarSchema, updateSuratMasukSchema } from '../validators/schemas.js';

const log = createLogger('GoogleDriveImportService');

/**
 * Public Google Sheets Import Service
 * Imports data from public Google Spreadsheets into SIMSA.
 * Uses the public CSV export URL (no API key required).
 */

/** updated and locked only with sinkron: a recorded letter was updated, or differs but stays as it is. */
export type ImportRowStatus = 'imported' | 'updated' | 'duplicate' | 'locked' | 'invalid' | 'empty';

/** What happened to one data row, as the source shows it. */
export interface ImportRowOutcome {
    /** Data row number from 1: non-empty rows below the header, as in errors and progress notices. */
    row: number;
    /** The source's own sequence column ("No"), when mapped. */
    no: string;
    nomorSurat: string;
    /** The date cell as written in the source. */
    tanggal: string;
    /** Shortened to REPORTED_PERIHAL_LENGTH characters. */
    perihal: string;
    status: ImportRowStatus;
    reason?: string;
    /** Sinkron: the fields updated, or that would be updated where the letter stays locked. */
    changes?: ImportFieldChange[];
}

export interface ImportResult {
    success: boolean;
    totalRows: number;
    importedRows: number;
    skippedRows: number;
    /** Recorded letters left as they are, including (with sinkron) those that could not be updated. */
    duplicateRows: number;
    /** Sinkron: recorded letters updated from the source. */
    updatedRows: number;
    /** At most 20; `rows` has the outcome of every row. */
    errors: string[];
    /** Every data row this request handled, in source order (startRow..nextRow-1 for a part). */
    rows?: ImportRowOutcome[];
    /** Resumable imports only: counts above cover data rows startRow..nextRow-1 (or to the end). */
    startRow?: number;
    /** The data row to continue from, or null when the sheet is finished. */
    nextRow?: number | null;
    /** Send back with nextRow; proves the rows before it are unchanged. */
    prefixHash?: string;
}

export interface ImportPreview {
    headers: string[]; rows: string[][]; totalRows: number;
    importType: GoogleSheetsImportType;
    /** 1-based among the non-empty rows; 0 when the source is empty. */
    headerRow: number;
    mapping: SheetColumnMapping[];
}

/** A tab by gid, or by name for older clients. */
export type SheetSelector = string | { gid: string };

/** Canonical creation plus the identity it checks, and the sinkron update; implemented by the surat services. */
interface ImportTarget<T> {
    importIdentityKey(record: T): SuratImportIdentityKey;
    existingImportIdentities(keys: SuratImportIdentityKey[]): Promise<boolean[]>;
    createImported(record: T, auditContext: CriticalAuditContext, options: GoogleSheetsRequestOptions): Promise<unknown>;
    importMatches(keys: SuratImportIdentityKey[]): Promise<SuratImportMatch[][]>;
    sync: ImportSyncTarget;
}
// Imported rows are written only by the canonical surat services.
const incoming: ImportTarget<NewSuratMasuk> = {
    importIdentityKey: record => suratMasukService.importIdentityKey(record),
    existingImportIdentities: keys => suratMasukService.existingImportIdentities(keys),
    createImported: (record, auditContext, options) => suratMasukService.createImported(record, auditContext, options),
    importMatches: keys => suratMasukService.importMatches(keys),
    sync: {
        entityType: 'surat_masuk', updateSchema: updateSuratMasukSchema,
        update: (id, patch, unitKerjaId, auditContext, auditDetails) =>
            suratMasukService.update(id, patch, unitKerjaId, undefined, auditContext, undefined, auditDetails),
    },
};
const outgoing: ImportTarget<NewSuratKeluar & { numberingMode: 'manual' }> = {
    importIdentityKey: record => suratKeluarService.importIdentityKey(record),
    existingImportIdentities: keys => suratKeluarService.existingImportIdentities(keys),
    createImported: (record, auditContext, options) => suratKeluarService.createImported(record, auditContext, options),
    importMatches: keys => suratKeluarService.importMatches(keys),
    sync: {
        entityType: 'surat_keluar', updateSchema: updateSuratKeluarSchema,
        update: (id, patch, unitKerjaId, auditContext, auditDetails) =>
            suratKeluarService.update(id, patch, unitKerjaId, undefined, auditContext, undefined, auditDetails),
    },
};
type PreparedRecord<T> = { record: T; key: SuratImportIdentityKey };
/** null: an empty row; error: a row rejected before any write. */
type PreparedRow<T> = PreparedRecord<T> | { error: unknown } | null;
type RowSummary = Pick<ImportRowOutcome, 'no' | 'nomorSurat' | 'tanggal' | 'perihal'>;
/** What a source row would set on its recorded letter, and the counterpart it names. */
type ImportSyncSource = { values: Record<string, string>; counterpart: ImportCounterpart };

const REPORTED_PERIHAL_LENGTH = 200;
const ALREADY_RECORDED = 'Sudah tercatat di SIMSA pada unit ini (termasuk surat yang dihapus).';
const EMPTY_ROW = 'Nomor surat dan perihal kosong.';
const IDENTITY_LABELS: Record<string, string> = {
    nomor: 'Nomor surat dan tahun',
    counterpart: 'Tanggal, perihal, dan pengirim/tujuan',
    link: 'Tanggal, perihal, dan tautan dokumen',
};
function sameAsEarlierRow(key: SuratImportIdentityKey, row: number): string {
    return `${IDENTITY_LABELS[key.by] ?? 'Identitas impor'} sama dengan baris data ke-${row} pada sumber ini.`;
}

export class GoogleDriveImportService {
    /**
     * Parse date string in various formats to ISO YYYY-MM-DD
     * Handles: DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, YYYY-MM-DD, etc.
     */
    private parseDate(dateStr: string): string | null {
        if (!dateStr || dateStr.trim() === '' || dateStr === '-') return null;

        const trimmed = dateStr.trim();

        // Already ISO format: YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

        // DD/MM/YYYY or DD-MM-YYYY
        const ddmmyyyy = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
        if (ddmmyyyy) {
            const [, d, m, y] = ddmmyyyy;
            const day = parseInt(d);
            const month = parseInt(m);
            // If day > 12, it must be DD/MM/YYYY format
            if (day > 12) {
                return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
            }
            // If month > 12, it must be MM/DD/YYYY format
            if (month > 12) {
                return `${y}-${d.padStart(2, '0')}-${m.padStart(2, '0')}`;
            }
            // Assume DD/MM/YYYY (Indonesian format)
            return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }

        // Try native Date parsing as fallback
        const parsed = new Date(trimmed);
        if (!isNaN(parsed.getTime())) {
            return parsed.toISOString().split('T')[0];
        }

        return null;
    }

    /**
     * Extract year from a date string
     */
    private extractYear(dateStr: string): number {
        const parsed = this.parseDate(dateStr);
        if (parsed) {
            return parseInt(parsed.split('-')[0]);
        }
        return new Date().getFullYear();
    }

    /**
     * Extract spreadsheet ID from various Google Sheets URL formats
     */
    extractSpreadsheetId(value: string): string | null {
        if (typeof value !== 'string' || value.length > 2048) return null;
        try {
            const url = new URL(value);
            if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.port || url.username || url.password) return null;
            return /^\/spreadsheets\/d\/([a-zA-Z0-9_-]{1,200})(?:\/|$)/.exec(url.pathname)?.[1] || null;
        } catch { return null; }
    }
    /**
     * Fetch a spreadsheet sheet as CSV using public export URL
     */
    async fetchSheetAsCSV(spreadsheetId: string, sheetName?: string, gid?: string, options: GoogleSheetsRequestOptions = {}): Promise<string> {
        assertSpreadsheetId(spreadsheetId);
        assertSheetName(sheetName);
        if (gid !== undefined && !/^\d{1,20}$/.test(gid)) throw new ValidationError('GID sheet tidak valid.');
        const url = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`);
        url.searchParams.set('tqx', 'out:csv');
        if (gid) url.searchParams.set('gid', gid);
        else if (sheetName) url.searchParams.set('sheet', sheetName);
        const source = new GoogleSheetsSource(options);
        try {
            const text = await source.text(url.toString());
            if (/^\s*(?:<!doctype html|<html)/i.test(text)) throw new GoogleSheetsAccessError();
            return text;
        }
        finally { source.close(); }
    }
    /**
     * List the spreadsheet's tabs (name + gid) from its public editor page.
     * An empty list means none were detected; the caller then relies on the gid in the link.
     */
    async listSheets(spreadsheetId: string, options: GoogleSheetsRequestOptions = {}): Promise<SheetTab[]> {
        assertSpreadsheetId(spreadsheetId);
        const source = new GoogleSheetsSource(options);
        try {
            return parseSheetTabs(await source.text(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, GOOGLE_SHEETS_LIMITS.htmlBytes));
        } catch (error) {
            // A very large editor page only hides the tab list; the linked gid still works.
            if (error instanceof PayloadTooLargeError) return [];
            throw error;
        } finally { source.close(); }
    }

    private fetchSelectedSheet(spreadsheetId: string, sheet: SheetSelector, options: GoogleSheetsRequestOptions): Promise<string> {
        return typeof sheet === 'string'
            ? this.fetchSheetAsCSV(spreadsheetId, sheet, undefined, options)
            : this.fetchSheetAsCSV(spreadsheetId, undefined, sheet.gid, options);
    }
    /**
     * Parse CSV text into array of arrays
     * Handles quoted fields with commas and newlines
     */
    parseCSV(csvText: string): string[][] {
        return parseBoundedSheetCsv(csvText);
    }

    private assertDataRows(rows: string[][]): void {
        if (rows.length > GOOGLE_SHEETS_LIMITS.dataRows) throw new PayloadTooLargeError('Maksimal 1.000 baris data per impor. Pecah spreadsheet sebelum mencoba lagi.');
    }

    /** The public message of a rejected row; internal errors stay generic. Logged like the error list, 20 rows at most. */
    private rowFailure(error: unknown, row: number, logged: boolean): { message: string; code: string } {
        const failure = publicErrorResponse(error, currentRequestId());
        if (logged) log.warn({ event: 'google_sheets_row_rejected', row, publicCode: failure.code }, 'Import row rejected');
        return { message: failure.message, code: failure.code };
    }
    private assertPreviewRows(maxRows: number): void {
        if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > GOOGLE_SHEETS_LIMITS.previewRows) throw new ValidationError('maxRows harus bilangan bulat antara 1 dan 100.');
    }

    /**
     * Preview first N rows from a spreadsheet
     */
    async previewData(spreadsheetId: string, sheet: SheetSelector, maxRows: number = 10,
        options: GoogleSheetsRequestOptions = {}, importType: GoogleSheetsImportType = 'surat-masuk'): Promise<ImportPreview> {
        this.assertPreviewRows(maxRows);
        const csvText = await this.fetchSelectedSheet(spreadsheetId, sheet, options);
        return this.previewRows(this.parseCSV(csvText), maxRows, importType);
    }

    /**
     * The column mapping and first N data rows of already-parsed rows from
     * any source, exactly as importRows will map them.
     */
    previewRows(allRows: string[][], maxRows: number = 10, importType: GoogleSheetsImportType = 'surat-masuk'): ImportPreview {
        this.assertPreviewRows(maxRows);
        if (allRows.length === 0) return { headers: [], rows: [], totalRows: 0, importType, headerRow: 0, mapping: [] };
        const { headers, headerRowIndex, mapping } = resolveSheetMapping(allRows, importType);
        const dataRows = allRows.slice(headerRowIndex + 1);
        this.assertDataRows(dataRows);
        return { headers, rows: dataRows.slice(0, maxRows), totalRows: dataRows.length,
            importType, headerRow: headerRowIndex + 1, mapping };
    }

    /**
     * Import Surat Masuk from Google Spreadsheet
     * Expected columns (exact normalized header aliases; never inferred by position):
     * ID, No, Jenis Surat, Sifat Surat, Nomor Surat, Tanggal Surat,
     * Perihal, Dari, Kepada, Status, Disposisi, Timestamp, Status Arsip
     */
    async importSuratMasuk(
        spreadsheetId: string,
        sheet: SheetSelector,
        unitKerjaId: string,
        auditContext: CriticalAuditContext,
        options: GoogleSheetsRequestOptions = {},
        resume?: ImportResume,
        sync?: ImportSync,
    ): Promise<ImportResult> {
        const csvText = await this.fetchSelectedSheet(spreadsheetId, sheet, options);
        return this.importRows('surat-masuk', this.parseCSV(csvText), unitKerjaId, auditContext, options, resume, sync);
    }

    /**
     * Import Surat Keluar from Google Spreadsheet
     */
    async importSuratKeluar(
        spreadsheetId: string,
        sheet: SheetSelector,
        unitKerjaId: string,
        auditContext: CriticalAuditContext,
        options: GoogleSheetsRequestOptions = {},
        resume?: ImportResume,
        sync?: ImportSync,
    ): Promise<ImportResult> {
        const csvText = await this.fetchSelectedSheet(spreadsheetId, sheet, options);
        return this.importRows('surat-keluar', this.parseCSV(csvText), unitKerjaId, auditContext, options, resume, sync);
    }

    /**
     * Import already-parsed rows from any source (Google Sheets, a CSV or XLSX
     * file): detect the header row, map columns by their titles, then run the
     * bounded row loop below, optionally as one time-budgeted part.
     */
    async importRows(
        type: GoogleSheetsImportType,
        allRows: string[][],
        unitKerjaId: string,
        auditContext: CriticalAuditContext,
        options: GoogleSheetsRequestOptions = {},
        resume?: ImportResume,
        sync?: ImportSync,
    ): Promise<ImportResult> {
        if (allRows.length < 2) {
            return { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, duplicateRows: 0, updatedRows: 0, errors: ['No data found'] };
        }

        const { headerRowIndex, columnMap: colMap } = resolveSheetMapping(allRows, type);
        const dataRows = allRows.slice(headerRowIndex + 1);
        this.assertDataRows(dataRows);
        const field = (row: string[], name: string) => this.getField(row, colMap, name);
        const summary = (row: string[]): RowSummary => {
            const perihal = field(row, 'perihal');
            return { no: field(row, 'noUrut'), nomorSurat: field(row, 'nomorSurat'), tanggal: field(row, 'tanggalSurat'),
                perihal: perihal.length > REPORTED_PERIHAL_LENGTH ? `${perihal.slice(0, REPORTED_PERIHAL_LENGTH - 1)}…` : perihal };
        };
        // Sinkron: the values a row sets, read like the record built from it and
        // stored the way the edit form stores text. An empty cell or an unmapped
        // column sets nothing, so it never clears a value.
        const syncSource = (row: string[], names: string[], counterpart: Omit<ImportCounterpart, 'value'>): ImportSyncSource => {
            const values: Record<string, string> = {
                perihal: field(row, 'perihal'),
                tanggalSurat: this.parseDate(field(row, 'tanggalSurat')) ?? '',
                sifatSurat: normalizeSifatSurat(field(row, 'sifatSurat')) ?? '',
                linkDokumen: isWebAddress(field(row, 'linkDokumen')) ? field(row, 'linkDokumen') : '',
                naskahDinas: field(row, 'naskahDinas'),
                jenisSurat: field(row, 'jenisSurat'),
            };
            return {
                values: Object.fromEntries(names.map(name => [name, syncSourceText(values[name])]).filter(([, value]) => value)),
                counterpart: { ...counterpart, value: field(row, counterpart.field) },
            };
        };
        const write = { unitKerjaId, auditContext, options, resume, sync };

        return type === 'surat-masuk'
            ? this.importRecords(dataRows, incoming, write, {
                summary, build: (row, i) => this.incomingRecord(row, i, colMap, unitKerjaId, auditContext),
                syncSource: row => syncSource(row, ['perihal', 'tanggalSurat', 'jenisSurat'], { field: 'dari', label: 'Pengirim' }) })
            : this.importRecords(dataRows, outgoing, write, {
                summary, build: (row, i) => this.outgoingRecord(row, i, colMap, unitKerjaId, auditContext),
                syncSource: row => syncSource(row, ['perihal', 'tanggalSurat', 'sifatSurat', 'linkDokumen', 'naskahDinas'],
                    { field: 'kepada', label: 'Tujuan' }) });
    }

    private incomingRecord(row: string[], i: number, colMap: Record<string, number>, unitKerjaId: string,
        auditContext: CriticalAuditContext): NewSuratMasuk | null {
        const nomorSurat = this.getField(row, colMap, 'nomorSurat');
        const perihal = this.getField(row, colMap, 'perihal');
        // Only skip if BOTH nomor surat and perihal are empty (truly empty row)
        if (!nomorSurat && !perihal) return null;

        const noUrut = parseInt(this.getField(row, colMap, 'noUrut') || String(i + 1)) || (i + 1);
        const tanggalStr = this.getField(row, colMap, 'tanggalSurat');
        const parsedDate = this.parseDate(tanggalStr);
        const dari = this.getField(row, colMap, 'dari');
        const tahun = tanggalStr ? this.extractYear(tanggalStr) : new Date().getFullYear();
        const effectiveTahun = isNaN(tahun) ? new Date().getFullYear() : tahun;

        const disposisiRaw = this.getField(row, colMap, 'disposisi');
        const disposisiArr = disposisiRaw ? disposisiRaw.split(/[,;]/).map(d => d.trim()).filter(Boolean) : [];

        const newSurat: NewSuratMasuk = {
            unitKerjaId,
            noUrut: noUrut,
            tahun: effectiveTahun,
            jenisSurat: this.getField(row, colMap, 'jenisSurat') || 'Surat Dinas',
            sifatSurat: this.getField(row, colMap, 'sifatSurat') || 'Biasa',
            nomorSurat: nomorSurat || '-',
            tanggalSurat: parsedDate,
            perihal: this.getField(row, colMap, 'perihal') || '',
            dari,
            kepada: this.getField(row, colMap, 'kepada') || '',
            status: 'belum_dibalas',
            disposisi: disposisiArr.length > 0 ? disposisiArr : null,
            createdBy: auditContext.userId,
        };
        return newSurat;
    }

    private outgoingRecord(row: string[], i: number, colMap: Record<string, number>, unitKerjaId: string,
        auditContext: CriticalAuditContext): NewSuratKeluar & { numberingMode: 'manual' } | null {
        const nomorSurat = this.getField(row, colMap, 'nomorSurat');
        const perihal = this.getField(row, colMap, 'perihal');
        // Only skip if BOTH nomor surat and perihal are empty
        if (!nomorSurat && !perihal) return null;

        const noUrut = parseInt(this.getField(row, colMap, 'noUrut') || String(i + 1)) || (i + 1);
        const tanggalStr = this.getField(row, colMap, 'tanggalSurat');
        const parsedDate = this.parseDate(tanggalStr);
        const kepada = this.getField(row, colMap, 'kepada');
        const tahun = tanggalStr ? this.extractYear(tanggalStr) : new Date().getFullYear();
        const effectiveTahun = isNaN(tahun) ? new Date().getFullYear() : tahun;

        const klasifikasiJenis = this.getField(row, colMap, 'klasifikasiJenis');
        const klasifikasiKode = this.getField(row, colMap, 'klasifikasiKode');
        const klasifikasiArsip = this.getField(row, colMap, 'klasifikasiArsip');
        const link = this.getField(row, colMap, 'linkDokumen');

        const newSurat: NewSuratKeluar & { numberingMode: 'manual' } = {
            unitKerjaId,
            noUrut: noUrut,
            tahun: effectiveTahun,
            naskahDinas: this.getField(row, colMap, 'naskahDinas') || 'Surat Dinas',
            sifatSurat: normalizeSifatSurat(this.getField(row, colMap, 'sifatSurat')),
            numberingMode: 'manual',
            nomorSurat: nomorSurat || '-',
            tanggalSurat: parsedDate,
            perihal: this.getField(row, colMap, 'perihal') || '',
            kepada,
            linkDokumen: isWebAddress(link) ? link : null,
            klasifikasiFasilitatif: klasifikasiJenis === 'fasilitatif' ? klasifikasiArsip : null,
            klasifikasiFasilitatifKode: klasifikasiJenis === 'fasilitatif' ? klasifikasiKode : null,
            klasifikasiSubstantif: klasifikasiJenis === 'substantif' ? klasifikasiArsip : null,
            klasifikasiSubstantifKode: klasifikasiJenis === 'substantif' ? klasifikasiKode : null,
            createdBy: auditContext.userId,
        };
        return newSurat;
    }

    /**
     * Import prepared rows in sheet order. One advisory lookup finds rows that
     * are already recorded; every other row goes through canonical creation,
     * which owns numbering, the authoritative duplicate check, audit
     * persistence, and the gated SRIKANDI outbox in one transaction. A failed
     * audit or producer therefore rolls that row back instead of creating an
     * unaudited import.
     *
     * With `resume`, the import starts at resume.startRow and starts no new
     * row after resume.deadlineAt; the result says where to continue.
     *
     * With `sync`, the lookup also returns the recorded letters, and the
     * first source row of an identity updates its letter (see import-sync).
     * A later row repeating that identity never does, so a register that
     * repeats a number cannot flip a letter back and forth.
     */
    private async importRecords<T>(
        dataRows: string[][],
        target: ImportTarget<T>,
        { unitKerjaId, auditContext, options, resume, sync }: {
            unitKerjaId: string; auditContext: CriticalAuditContext; options: GoogleSheetsRequestOptions;
            resume: ImportResume | undefined; sync: ImportSync | undefined;
        },
        { summary, build, syncSource }: {
            summary: (row: string[]) => RowSummary;
            build: (row: string[], index: number) => T | null;
            syncSource: (row: string[]) => ImportSyncSource;
        },
    ): Promise<ImportResult> {
        // Every row as this import reads it. The resume digest covers exactly
        // these values, so a column the import never reads (a formula, a source
        // ID or status note) cannot block resuming.
        const built = dataRows.map((row, i): { record: T | null } | { error: unknown } => {
            try { return { record: build(row, i) }; } catch (error) { return { error }; }
        });
        const readRows = built.map(item => 'error' in item ? { unreadable: true } : item.record);
        const start = resume?.startRow ?? 0;
        if (resume) assertImportResumable(readRows, resume);
        // Identities of every row, earlier parts included, so a row repeating
        // an identity can name the row it repeats.
        const prepared = built.map((item): PreparedRow<T> => {
            if ('error' in item) return item;
            if (!item.record) return null;
            try { return { record: item.record, key: target.importIdentityKey(item.record) }; } catch (error) { return { error }; }
        });
        const firstRowOf = new Map<string, number>();
        prepared.forEach((item, index) => {
            const identity = item && 'key' in item ? JSON.stringify(item.key) : undefined;
            if (identity !== undefined && !firstRowOf.has(identity)) firstRowOf.set(identity, index);
        });
        const recorded = prepared.slice(start).flatMap(item => item && 'key' in item ? [item] : []);
        const keys = recorded.map(item => item.key);
        const matches = sync && keys.length ? await target.importMatches(keys) : [];
        const existing = sync ? matches.map(found => found.length > 0)
            : keys.length ? await target.existingImportIdentities(keys) : [];
        const matchOf = new Map(recorded.map((item, index) => [item, matches[index] ?? []]));
        const alreadyRecorded = new Set(recorded.filter((_item, index) => existing[index]));

        const errors: string[] = [];
        const rows: ImportRowOutcome[] = [];
        const report = (i: number, status: ImportRowStatus, reason?: string, changes?: ImportFieldChange[]) =>
            rows.push({ row: i + 1, ...summary(dataRows[i]), status, ...(reason ? { reason } : {}), ...(changes ? { changes } : {}) });
        const earlierRow = (item: PreparedRecord<T>, i: number) => {
            const first = firstRowOf.get(JSON.stringify(item.key));
            return first !== undefined && first < i ? first : undefined;
        };
        const duplicateReason = (item: PreparedRecord<T>, i: number) => {
            const first = earlierRow(item, i);
            return first !== undefined ? sameAsEarlierRow(item.key, first + 1) : ALREADY_RECORDED;
        };
        let importedRows = 0;
        let skippedRows = 0;
        let duplicateRows = 0;
        let updatedRows = 0;
        let nextRow: number | null = null;
        // Sinkron: a numbered and an unnumbered row can match the same letter;
        // only the first one in this part applies to it.
        const syncedLetterRow = new Map<string, number>();

        for (let i = start; i < dataRows.length; i++) {
            if (options.signal?.aborted) throw new AppError('Permintaan impor dibatalkan; baris yang sudah selesai tetap tercatat.', 499);
            // Every part handles at least one row, so a continuation always advances.
            if (resume && i > start && Date.now() >= resume.deadlineAt) { nextRow = i; break; }
            const item = prepared[i];
            if (!item) { skippedRows++; report(i, 'empty', EMPTY_ROW); continue; }
            if (alreadyRecorded.has(item as PreparedRecord<T>)) {
                const record = item as PreparedRecord<T>;
                if (!sync || earlierRow(record, i) !== undefined) {
                    duplicateRows++; report(i, 'duplicate', duplicateReason(record, i)); continue;
                }
                const letters = matchOf.get(record)!;
                const sameLetter = letters.length === 1 ? syncedLetterRow.get(letters[0].id) : undefined;
                if (sameLetter !== undefined) {
                    duplicateRows++; report(i, 'duplicate', `Surat yang sama sudah dicocokkan dengan baris data ke-${sameLetter + 1} pada sumber ini.`); continue;
                }
                if (letters.length === 1) syncedLetterRow.set(letters[0].id, i);
                const source = syncSource(dataRows[i]);
                const outcome = await syncImportedLetter(target.sync, letters, source.values, sync, unitKerjaId, auditContext, source.counterpart);
                if (outcome.status === 'updated') updatedRows++; else duplicateRows++;
                report(i, outcome.status, 'reason' in outcome ? outcome.reason : undefined, 'changes' in outcome ? outcome.changes : undefined);
                continue;
            }
            try {
                if ('error' in item) throw item.error;
                if (options.signal?.aborted) throw new AppError('Permintaan impor dibatalkan.', 499);
                await target.createImported(item.record, auditContext, options);
                importedRows++;
                report(i, 'imported');
            } catch (error) {
                if (error instanceof DuplicateSuratImportError) {
                    duplicateRows++; report(i, 'duplicate', duplicateReason(item as PreparedRecord<T>, i)); continue;
                }
                const failure = this.rowFailure(error, i + 1, errors.length < 20);
                if (errors.length < 20) errors.push(`Row ${i + 1}: ${failure.message} (${failure.code})`);
                skippedRows++;
                report(i, 'invalid', failure.message);
            }
        }

        return {
            success: errors.length === 0,
            totalRows: dataRows.length,
            importedRows,
            skippedRows,
            duplicateRows,
            updatedRows,
            errors: errors.slice(0, 20), // Limit error list
            rows,
            ...(resume ? { startRow: start, nextRow, ...(nextRow === null ? {} : { prefixHash: importPrefixHash(readRows, nextRow) }) } : {}),
        };
    }

    /**
     * Get field value from row using column map
     */
    private getField(row: string[], colMap: Record<string, number>, fieldName: string): string {
        const idx = colMap[fieldName];
        if (idx === undefined || idx >= row.length) return '';
        return (row[idx] || '').trim();
    }
}

export const googleDriveImportService = new GoogleDriveImportService();
