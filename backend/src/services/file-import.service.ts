import type { CriticalAuditContext } from './audit-log.service.js';
import { googleDriveImportService } from './google-drive-import.service.js';
import type { GoogleSheetsImportType } from './google-sheets-import-mapping.js';
import type { GoogleSheetsRequestOptions } from './google-sheets-source.js';
import type { ImportResume } from './import-resume.js';
import { listImportFileSheets, readImportFile, type ImportFileUpload } from './import-file-reader.js';

/**
 * CSV and XLSX uploads for surat masuk/keluar. A file is only a different
 * source of rows: header detection, column mapping, sifat, import identity,
 * the duplicate lookup, resumable parts and audit are the Google Sheets
 * import's own (GoogleDriveImportService.previewRows / importRows).
 * Each request reads the uploaded file from memory; nothing is stored.
 */
export const fileImportService = {
    sheets(file: ImportFileUpload) {
        return listImportFileSheets(file);
    },

    async preview(file: ImportFileUpload, sheet: string | undefined, maxRows: number, type: GoogleSheetsImportType) {
        const content = await readImportFile(file, sheet);
        return { format: content.format, sheets: content.sheets, sheet: content.sheet,
            ...googleDriveImportService.previewRows(content.rows, maxRows, type) };
    },

    async importSurat(type: GoogleSheetsImportType, file: ImportFileUpload, sheet: string | undefined, unitKerjaId: string,
        auditContext: CriticalAuditContext, options: GoogleSheetsRequestOptions = {}, resume?: ImportResume) {
        const { rows } = await readImportFile(file, sheet);
        return googleDriveImportService.importRows(type, rows, unitKerjaId, auditContext, options, resume);
    },
};
