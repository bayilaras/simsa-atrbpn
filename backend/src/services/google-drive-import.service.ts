import { type NewSuratMasuk } from '../db/schema/surat-masuk';
import { type NewSuratKeluar } from '../db/schema/surat-keluar';
import { createLogger } from '../utils/logger';
import { suratMasukService } from './surat-masuk.service.js';
import { suratKeluarService } from './surat-keluar.service.js';
import type { CriticalAuditContext } from './audit-log.service.js';
import { AppError, PayloadTooLargeError, ValidationError } from '../utils/errors.js';
import { publicErrorResponse } from '../utils/public-error.js';
import { currentRequestId } from '../utils/request-context.js';
import { GOOGLE_SHEETS_LIMITS, GoogleSheetsAccessError, GoogleSheetsSource, assertSheetName, assertSpreadsheetId, parseBoundedSheetCsv, type GoogleSheetsRequestOptions } from './google-sheets-source.js';

import { resolveSheetMapping, type GoogleSheetsImportType, type SheetColumnMapping } from './google-sheets-import-mapping.js';
import { DuplicateSuratImportError } from './surat-import-identity.js';

const log = createLogger('GoogleDriveImportService');

/**
 * Public Google Sheets Import Service
 * Imports data from public Google Spreadsheets into SIMSA.
 * Uses the public CSV export URL (no API key required).
 */

interface ImportResult {
    success: boolean;
    totalRows: number;
    importedRows: number;
    skippedRows: number;
    duplicateRows: number;
    errors: string[];
}

interface SheetInfo {
    name: string;
    gid: string;
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
     * List available sheets in a spreadsheet by parsing the HTML
     */
    async listSheets(spreadsheetId: string, options: GoogleSheetsRequestOptions = {}): Promise<SheetInfo[]> {
        assertSpreadsheetId(spreadsheetId);
        const source = new GoogleSheetsSource(options);
        try {
            const html = await source.text(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, GOOGLE_SHEETS_LIMITS.htmlBytes);
            const sheets: SheetInfo[] = [];
            for (const match of html.matchAll(/gid=(\d{1,20})[^"]*"[^>]*>([^<]+)</g)) {
                if (!sheets.some(sheet => sheet.gid === match[1])) sheets.push({ gid: match[1], name: match[2].trim().slice(0, 100) });
                if (sheets.length >= GOOGLE_SHEETS_LIMITS.sheets) break;
            }
            if (sheets.length === 0) {
                const commonNames = ['Sheet1', 'Surat Masuk 2021', 'Surat Masuk 2022', 'Surat Masuk 2023',
                    'Surat Masuk 2024', 'Surat Masuk 2025', 'Surat Masuk 2026',
                    'Surat Keluar 2023', 'Surat Keluar 2024', 'Surat Keluar 2025', 'Surat Keluar 2026'];
                for (const name of commonNames) {
                    try {
                        const probe = await source.text(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}&range=A1`, 64 * 1024);
                        if (probe.trim() && !/^\s*</.test(probe)) sheets.push({ gid: '0', name });
                    } catch (error) {
                        // Only an inaccessible/missing sheet is skippable; limits,
                        // cancellation, redirects and upstream faults end the operation.
                        if (error instanceof GoogleSheetsAccessError) continue;
                        throw error;
                    }
                }
            }
            return sheets;
        } finally { source.close(); }
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

    private rowError(error: unknown, row: number): string {
        const failure = publicErrorResponse(error, currentRequestId());
        log.warn({ event: 'google_sheets_row_rejected', row, publicCode: failure.code }, 'Import row rejected');
        return `Row ${row}: ${failure.message} (${failure.code})`;
    }
    /**
     * Preview first N rows from a spreadsheet
     */
    async previewData(spreadsheetId: string, sheetName: string, maxRows: number = 10,
        options: GoogleSheetsRequestOptions = {}, importType: GoogleSheetsImportType = 'surat-masuk'): Promise<{
        headers: string[]; rows: string[][]; totalRows: number;
        importType: GoogleSheetsImportType; headerRow: number; mapping: SheetColumnMapping[];
    }> {
        if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > GOOGLE_SHEETS_LIMITS.previewRows) throw new ValidationError('maxRows harus bilangan bulat antara 1 dan 100.');
        const csvText = await this.fetchSheetAsCSV(spreadsheetId, sheetName, undefined, options);
        const allRows = this.parseCSV(csvText);
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
        sheetName: string,
        unitKerjaId: string,
        auditContext: CriticalAuditContext,
        options: GoogleSheetsRequestOptions = {},
    ): Promise<ImportResult> {
        const csvText = await this.fetchSheetAsCSV(spreadsheetId, sheetName, undefined, options);
        const allRows = this.parseCSV(csvText);

        if (allRows.length < 2) {
            return { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, duplicateRows: 0, errors: ['No data found'] };
        }

        const { headerRowIndex, columnMap: colMap } = resolveSheetMapping(allRows, 'surat-masuk');
        const dataRows = allRows.slice(headerRowIndex + 1);
        this.assertDataRows(dataRows);

        const errors: string[] = [];
        let importedRows = 0;
        let skippedRows = 0;
        let duplicateRows = 0;

        for (let i = 0; i < dataRows.length; i++) {
            if (options.signal?.aborted) throw new AppError('Permintaan impor dibatalkan; baris yang sudah selesai tetap tercatat.', 499);
            const row = dataRows[i];
            try {
                const nomorSurat = this.getField(row, colMap, 'nomorSurat');
                const perihal = this.getField(row, colMap, 'perihal');
                // Only skip if BOTH nomor surat and perihal are empty (truly empty row)
                if (!nomorSurat && !perihal) {
                    skippedRows++;
                    continue;
                }

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

                // Canonical creation owns numbering, audit persistence, and the
                // gated SRIKANDI outbox in one transaction. A failed audit or
                // producer therefore rolls this row back instead of creating an
                // unaudited import.
                if (options.signal?.aborted) throw new AppError('Permintaan impor dibatalkan.', 499);
                await suratMasukService.createImported(newSurat, auditContext, options);
                importedRows++;
            } catch (error) {
                if (error instanceof DuplicateSuratImportError) { duplicateRows++; continue; }
                if (errors.length < 20) errors.push(this.rowError(error, i + 1));
                skippedRows++;
            }
        }

        return {
            success: errors.length === 0,
            totalRows: dataRows.length,
            importedRows,
            skippedRows,
            duplicateRows,
            errors: errors.slice(0, 20), // Limit error list
        };
    }

    /**
     * Import Surat Keluar from Google Spreadsheet
     */
    async importSuratKeluar(
        spreadsheetId: string,
        sheetName: string,
        unitKerjaId: string,
        auditContext: CriticalAuditContext,
        options: GoogleSheetsRequestOptions = {},
    ): Promise<ImportResult> {
        const csvText = await this.fetchSheetAsCSV(spreadsheetId, sheetName, undefined, options);
        const allRows = this.parseCSV(csvText);

        if (allRows.length < 2) {
            return { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, duplicateRows: 0, errors: ['No data found'] };
        }

        const { headerRowIndex, columnMap: colMap } = resolveSheetMapping(allRows, 'surat-keluar');
        const dataRows = allRows.slice(headerRowIndex + 1);
        this.assertDataRows(dataRows);

        const errors: string[] = [];
        let importedRows = 0;
        let skippedRows = 0;
        let duplicateRows = 0;

        for (let i = 0; i < dataRows.length; i++) {
            if (options.signal?.aborted) throw new AppError('Permintaan impor dibatalkan; baris yang sudah selesai tetap tercatat.', 499);
            const row = dataRows[i];
            try {
                const nomorSurat = this.getField(row, colMap, 'nomorSurat');
                const perihal = this.getField(row, colMap, 'perihal');
                // Only skip if BOTH nomor surat and perihal are empty
                if (!nomorSurat && !perihal) {
                    skippedRows++;
                    continue;
                }

                const noUrut = parseInt(this.getField(row, colMap, 'noUrut') || String(i + 1)) || (i + 1);
                const tanggalStr = this.getField(row, colMap, 'tanggalSurat');
                const parsedDate = this.parseDate(tanggalStr);
                const kepada = this.getField(row, colMap, 'kepada');
                const tahun = tanggalStr ? this.extractYear(tanggalStr) : new Date().getFullYear();
                const effectiveTahun = isNaN(tahun) ? new Date().getFullYear() : tahun;

                const klasifikasiJenis = this.getField(row, colMap, 'klasifikasiJenis');
                const klasifikasiKode = this.getField(row, colMap, 'klasifikasiKode');
                const klasifikasiArsip = this.getField(row, colMap, 'klasifikasiArsip');

                const newSurat: NewSuratKeluar & { numberingMode: 'manual' } = {
                    unitKerjaId,
                    noUrut: noUrut,
                    tahun: effectiveTahun,
                    naskahDinas: this.getField(row, colMap, 'naskahDinas') || 'Surat Dinas',
                    numberingMode: 'manual',
                    nomorSurat: nomorSurat || '-',
                    tanggalSurat: parsedDate,
                    perihal: this.getField(row, colMap, 'perihal') || '',
                    kepada,
                    linkDokumen: this.getField(row, colMap, 'linkDokumen') || null,
                    klasifikasiFasilitatif: klasifikasiJenis === 'fasilitatif' ? klasifikasiArsip : null,
                    klasifikasiFasilitatifKode: klasifikasiJenis === 'fasilitatif' ? klasifikasiKode : null,
                    klasifikasiSubstantif: klasifikasiJenis === 'substantif' ? klasifikasiArsip : null,
                    klasifikasiSubstantifKode: klasifikasiJenis === 'substantif' ? klasifikasiKode : null,
                    createdBy: auditContext.userId,
                };

                if (options.signal?.aborted) throw new AppError('Permintaan impor dibatalkan.', 499);
                await suratKeluarService.createImported(newSurat, auditContext, options);
                importedRows++;
            } catch (error) {
                if (error instanceof DuplicateSuratImportError) { duplicateRows++; continue; }
                if (errors.length < 20) errors.push(this.rowError(error, i + 1));
                skippedRows++;
            }
        }

        return {
            success: errors.length === 0,
            totalRows: dataRows.length,
            importedRows,
            skippedRows,
            duplicateRows,
            errors: errors.slice(0, 20),
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
