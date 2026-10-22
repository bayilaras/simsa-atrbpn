import type { CriticalAuditContext } from './audit-log.service.js';
import { googleDriveImportService } from './google-drive-import.service.js';
import { linkColumns, type GoogleSheetsImportType } from './google-sheets-import-mapping.js';
import type { GoogleSheetsRequestOptions } from './google-sheets-source.js';
import type { ImportResume } from './import-resume.js';
import type { ImportSync } from './import-sync.js';
import { listImportFileSheets, readImportFile, type ImportFileContent, type ImportFileUpload } from './import-file-reader.js';

/**
 * A linked cell reads as its text, as in a Google Sheets CSV export, so a
 * Hal or Nomor Surat linked to its scan keeps its words. Only below the
 * header of a column titled as a document link does the cell become the
 * address it links to.
 */
function sourceRows(content: ImportFileContent, type: GoogleSheetsImportType): string[][] {
    if (!content.links.some(Boolean)) return content.rows;
    const { headerRowIndex, columns } = linkColumns(content.rows, type);
    if (!columns.length) return content.rows;
    return content.rows.map((row, index) => {
        const links = content.links[index];
        if (index <= headerRowIndex || !links || !columns.some(column => links[column])) return row;
        return row.map((value, column) => columns.includes(column) ? links[column] ?? value : value);
    });
}

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
            ...googleDriveImportService.previewRows(sourceRows(content, type), maxRows, type) };
    },

    async importSurat(type: GoogleSheetsImportType, file: ImportFileUpload, sheet: string | undefined, unitKerjaId: string,
        auditContext: CriticalAuditContext, options: GoogleSheetsRequestOptions = {}, resume?: ImportResume, sync?: ImportSync) {
        const content = await readImportFile(file, sheet);
        return googleDriveImportService.importRows(type, sourceRows(content, type), unitKerjaId, auditContext, options, resume, sync);
    },
};
