import { db } from '../config/database';
import { suratMasuk, type NewSuratMasuk } from '../db/schema/surat-masuk';
import { suratKeluar, type NewSuratKeluar } from '../db/schema/surat-keluar';
import { eq, and } from 'drizzle-orm';
import { createLogger } from '../utils/logger';
import { suratMasukService } from './surat-masuk.service.js';
import { suratKeluarService } from './surat-keluar.service.js';
import type { CriticalAuditContext } from './audit-log.service.js';

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
    extractSpreadsheetId(url: string): string | null {
        // Match: /spreadsheets/d/{ID}/
        const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
        return match ? match[1] : null;
    }

    /**
     * Fetch a spreadsheet sheet as CSV using public export URL
     */
    async fetchSheetAsCSV(spreadsheetId: string, sheetName?: string, gid?: string): Promise<string> {
        let url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv`;
        if (gid) {
            url += `&gid=${gid}`;
        } else if (sheetName) {
            url += `&sheet=${encodeURIComponent(sheetName)}`;
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch spreadsheet: ${response.status} ${response.statusText}`);
        }

        return await response.text();
    }

    /**
     * List available sheets in a spreadsheet by parsing the HTML
     */
    async listSheets(spreadsheetId: string): Promise<SheetInfo[]> {
        // We try to get sheet list from the spreadsheet HTML page
        const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
        try {
            const response = await fetch(url);
            const html = await response.text();

            // Extract sheet names from HTML - look for sheet tabs
            const sheets: SheetInfo[] = [];
            // Google Sheets puts sheet info in a JavaScript object on the page
            // Try to extract from the rendered HTML
            const sheetMatches = html.matchAll(/gid=(\d+)[^"]*"[^>]*>([^<]+)</g);
            for (const match of sheetMatches) {
                sheets.push({
                    gid: match[1],
                    name: match[2].trim(),
                });
            }

            if (sheets.length === 0) {
                // Fallback: try common sheet names
                const commonNames = ['Sheet1', 'Surat Masuk 2021', 'Surat Masuk 2022', 'Surat Masuk 2023',
                    'Surat Masuk 2024', 'Surat Masuk 2025', 'Surat Masuk 2026',
                    'Surat Keluar 2023', 'Surat Keluar 2024', 'Surat Keluar 2025', 'Surat Keluar 2026'];

                for (const name of commonNames) {
                    try {
                        const testUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}&range=A1`;
                        const testResp = await fetch(testUrl);
                        if (testResp.ok) {
                            sheets.push({ gid: '0', name });
                        }
                    } catch (_e) {
                        // Sheet doesn't exist, skip
                    }
                }
            }

            return sheets;
        } catch (error) {
            log.error({ err: error }, 'Error listing sheets:');
            return [{ gid: '0', name: 'Sheet1' }];
        }
    }

    /**
     * Parse CSV text into array of arrays
     * Handles quoted fields with commas and newlines
     */
    parseCSV(csvText: string): string[][] {
        const rows: string[][] = [];
        let currentRow: string[] = [];
        let currentField = '';
        let inQuotes = false;

        for (let i = 0; i < csvText.length; i++) {
            const char = csvText[i];
            const nextChar = csvText[i + 1];

            if (inQuotes) {
                if (char === '"' && nextChar === '"') {
                    // Escaped quote
                    currentField += '"';
                    i++;
                } else if (char === '"') {
                    // End of quoted field
                    inQuotes = false;
                } else {
                    currentField += char;
                }
            } else {
                if (char === '"') {
                    inQuotes = true;
                } else if (char === ',') {
                    currentRow.push(currentField.trim());
                    currentField = '';
                } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
                    currentRow.push(currentField.trim());
                    if (currentRow.some(f => f !== '')) {
                        rows.push(currentRow);
                    }
                    currentRow = [];
                    currentField = '';
                    if (char === '\r') i++; // Skip \n after \r
                } else {
                    currentField += char;
                }
            }
        }

        // Last field
        if (currentField || currentRow.length > 0) {
            currentRow.push(currentField.trim());
            if (currentRow.some(f => f !== '')) {
                rows.push(currentRow);
            }
        }

        return rows;
    }

    /**
     * Preview first N rows from a spreadsheet
     */
    async previewData(spreadsheetId: string, sheetName: string, maxRows: number = 10): Promise<{
        headers: string[];
        rows: string[][];
        totalRows: number;
    }> {
        const csvText = await this.fetchSheetAsCSV(spreadsheetId, sheetName);
        const allRows = this.parseCSV(csvText);

        if (allRows.length === 0) {
            return { headers: [], rows: [], totalRows: 0 };
        }

        // Try to detect header row - might be at row 0 or row 3 (Google Sheets format uses row 4)
        let headerRowIndex = 0;
        // Check if row has typical header keywords
        const headerKeywords = ['no', 'jenis', 'nomor', 'tanggal', 'perihal', 'id', 'surat', 'dari', 'kepada', 'status'];
        for (let i = 0; i < Math.min(5, allRows.length); i++) {
            const rowLower = allRows[i].map(f => f.toLowerCase());
            const matchCount = rowLower.filter(f => headerKeywords.some(kw => f.includes(kw))).length;
            if (matchCount >= 3) {
                headerRowIndex = i;
                break;
            }
        }

        const headers = allRows[headerRowIndex];
        const dataRows = allRows.slice(headerRowIndex + 1);

        return {
            headers,
            rows: dataRows.slice(0, maxRows),
            totalRows: dataRows.length,
        };
    }

    /**
     * Import Surat Masuk from Google Spreadsheet
     * Expected columns (matched by position or header name):
     * ID, No, Jenis Surat, Sifat Surat, Nomor Surat, Tanggal Surat,
     * Perihal, Dari, Kepada, Status, Disposisi, Timestamp, Status Arsip
     */
    async importSuratMasuk(
        spreadsheetId: string,
        sheetName: string,
        unitKerjaId: string,
        auditContext: CriticalAuditContext,
    ): Promise<ImportResult> {
        const csvText = await this.fetchSheetAsCSV(spreadsheetId, sheetName);
        const allRows = this.parseCSV(csvText);

        if (allRows.length < 2) {
            return { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, duplicateRows: 0, errors: ['No data found'] };
        }

        // Detect header row
        let headerRowIndex = 0;
        const headerKeywords = ['no', 'jenis', 'nomor', 'tanggal', 'perihal', 'dari', 'kepada'];
        for (let i = 0; i < Math.min(5, allRows.length); i++) {
            const rowLower = allRows[i].map(f => f.toLowerCase());
            const matchCount = rowLower.filter(f => headerKeywords.some(kw => f.includes(kw))).length;
            if (matchCount >= 3) {
                headerRowIndex = i;
                break;
            }
        }

        const headers = allRows[headerRowIndex].map(h => h.toLowerCase().trim());
        const dataRows = allRows.slice(headerRowIndex + 1);

        // Map column indices
        const colMap = this.buildColumnMap(headers, {
            'id': ['id'],
            'no': ['no', 'no.', 'nomor urut', 'no urut'],
            'jenisSurat': ['jenis surat', 'jenis naskah', 'jenis'],
            'sifatSurat': ['sifat surat', 'sifat', 'urgency'],
            'nomorSurat': ['nomor surat', 'no surat', 'nomor'],
            'tanggalSurat': ['tanggal surat', 'tanggal', 'tgl'],
            'perihal': ['perihal', 'subject', 'hal'],
            'dari': ['dari', 'asal', 'pengirim', 'from'],
            'kepada': ['kepada', 'tujuan', 'penerima', 'to'],
            'status': ['status', 'disposisi status'],
            'disposisi': ['disposisi'],
        });

        const errors: string[] = [];
        let importedRows = 0;
        let skippedRows = 0;
        let duplicateRows = 0;

        for (let i = 0; i < dataRows.length; i++) {
            const row = dataRows[i];
            try {
                const nomorSurat = this.getField(row, colMap, 'nomorSurat');
                const perihal = this.getField(row, colMap, 'perihal');
                // Only skip if BOTH nomor surat and perihal are empty (truly empty row)
                if (!nomorSurat && !perihal) {
                    skippedRows++;
                    continue;
                }

                const noUrut = parseInt(this.getField(row, colMap, 'no') || String(i + 1)) || (i + 1);
                const tanggalStr = this.getField(row, colMap, 'tanggalSurat');
                const parsedDate = this.parseDate(tanggalStr);
                const dari = this.getField(row, colMap, 'dari');
                const tahun = tanggalStr ? this.extractYear(tanggalStr) : new Date().getFullYear();
                const effectiveTahun = isNaN(tahun) ? new Date().getFullYear() : tahun;

                // Smart duplicate check:
                // - If nomor surat is valid: check by nomorSurat + tahun + unitKerjaId
                // - If the official number is absent: use a stable business
                //   fingerprint. The source row number is not durable because
                //   canonical creation allocates its own sequence.
                let existing;
                const hasValidNomor = nomorSurat && nomorSurat !== '-';
                if (hasValidNomor) {
                    existing = await db.select({ id: suratMasuk.id })
                        .from(suratMasuk)
                        .where(and(
                            eq(suratMasuk.nomorSurat, nomorSurat),
                            eq(suratMasuk.tahun, effectiveTahun),
                            eq(suratMasuk.unitKerjaId, unitKerjaId),
                        ))
                        .limit(1);
                } else {
                    if (!parsedDate || !perihal || !dari) {
                        errors.push(
                            `Row ${i + 1}: nomor surat kosong memerlukan tanggal, perihal, dan pengirim untuk identitas impor yang stabil`,
                        );
                        skippedRows++;
                        continue;
                    }
                    existing = await db.select({ id: suratMasuk.id })
                        .from(suratMasuk)
                        .where(and(
                            eq(suratMasuk.unitKerjaId, unitKerjaId),
                            eq(suratMasuk.tanggalSurat, parsedDate),
                            eq(suratMasuk.perihal, perihal),
                            eq(suratMasuk.dari, dari),
                        ))
                        .limit(1);
                }

                if (existing.length > 0) {
                    duplicateRows++;
                    continue;
                }

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
                await suratMasukService.create(newSurat, auditContext);
                importedRows++;
            } catch (error: any) {
                errors.push(`Row ${i + 1}: ${error.message}`);
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
    ): Promise<ImportResult> {
        const csvText = await this.fetchSheetAsCSV(spreadsheetId, sheetName);
        const allRows = this.parseCSV(csvText);

        if (allRows.length < 2) {
            return { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, duplicateRows: 0, errors: ['No data found'] };
        }

        // Detect header row
        let headerRowIndex = 0;
        const headerKeywords = ['no', 'nomor', 'tanggal', 'perihal', 'tujuan', 'kepada', 'link'];
        for (let i = 0; i < Math.min(5, allRows.length); i++) {
            const rowLower = allRows[i].map(f => f.toLowerCase());
            const matchCount = rowLower.filter(f => headerKeywords.some(kw => f.includes(kw))).length;
            if (matchCount >= 3) {
                headerRowIndex = i;
                break;
            }
        }

        const headers = allRows[headerRowIndex].map(h => h.toLowerCase().trim());
        const dataRows = allRows.slice(headerRowIndex + 1);

        const colMap = this.buildColumnMap(headers, {
            'id': ['id'],
            'noUrut': ['no urut', 'no.', 'no'],
            'naskahDinas': ['jenis surat', 'naskah dinas', 'jenis naskah', 'jenis'],
            'nomorSurat': ['nomor surat', 'no surat', 'nomor'],
            'tanggalSurat': ['tanggal surat', 'tanggal', 'tgl'],
            'perihal': ['perihal', 'subject', 'hal'],
            'kepada': ['kepada', 'tujuan', 'penerima'],
            'linkDokumen': ['link dokumen', 'link', 'url'],
            'klasifikasiArsip': ['klasifikasi arsip', 'klasifikasi'],
            'klasifikasiKode': ['klasifikasi kode', 'kode klasifikasi', 'kode'],
            'klasifikasiJenis': ['klasifikasi jenis', 'jenis klasifikasi'],
        });

        const errors: string[] = [];
        let importedRows = 0;
        let skippedRows = 0;
        let duplicateRows = 0;

        for (let i = 0; i < dataRows.length; i++) {
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

                // Smart duplicate check
                let existing;
                const hasValidNomor = nomorSurat && nomorSurat !== '-';
                if (hasValidNomor) {
                    existing = await db.select({ id: suratKeluar.id })
                        .from(suratKeluar)
                        .where(and(
                            eq(suratKeluar.nomorSurat, nomorSurat),
                            eq(suratKeluar.tahun, effectiveTahun),
                            eq(suratKeluar.unitKerjaId, unitKerjaId),
                        ))
                        .limit(1);
                } else {
                    if (!parsedDate || !perihal || !kepada) {
                        errors.push(
                            `Row ${i + 1}: nomor surat kosong memerlukan tanggal, perihal, dan tujuan untuk identitas impor yang stabil`,
                        );
                        skippedRows++;
                        continue;
                    }
                    existing = await db.select({ id: suratKeluar.id })
                        .from(suratKeluar)
                        .where(and(
                            eq(suratKeluar.unitKerjaId, unitKerjaId),
                            eq(suratKeluar.tanggalSurat, parsedDate),
                            eq(suratKeluar.perihal, perihal),
                            eq(suratKeluar.kepada, kepada),
                        ))
                        .limit(1);
                }

                if (existing.length > 0) {
                    duplicateRows++;
                    continue;
                }

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

                await suratKeluarService.create(newSurat, auditContext);
                importedRows++;
            } catch (error: any) {
                errors.push(`Row ${i + 1}: ${error.message}`);
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
     * Build a column mapping from header names to column indices
     */
    private buildColumnMap(headers: string[], mapping: Record<string, string[]>): Record<string, number> {
        const result: Record<string, number> = {};

        for (const [fieldName, aliases] of Object.entries(mapping)) {
            for (const alias of aliases) {
                const idx = headers.findIndex(h => h.includes(alias));
                if (idx !== -1) {
                    result[fieldName] = idx;
                    break;
                }
            }
        }

        // Fallback: positional mapping for known Google Spreadsheet format
        // Column order: ID, No, Jenis, Sifat, Nomor, Tanggal, Perihal, Dari, Kepada, Status, Disposisi, Timestamp, Status Arsip
        if (Object.keys(result).length < 5 && headers.length >= 8) {
            const posMap: Record<string, number> = {
                'id': 0, 'no': 1, 'jenisSurat': 2, 'sifatSurat': 3,
                'nomorSurat': 4, 'tanggalSurat': 5, 'perihal': 6, 'dari': 7,
                'kepada': 8, 'status': 9, 'disposisi': 10,
            };
            for (const [k, v] of Object.entries(posMap)) {
                if (!(k in result) && v < headers.length) {
                    result[k] = v;
                }
            }
        }

        return result;
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
