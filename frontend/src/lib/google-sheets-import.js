// Every import writes into one concrete unit; shown where an import cannot start yet.
export const IMPORT_UNIT_REQUIRED = 'Pilih unit kerja terlebih dahulu';

export function buildGoogleSheetsImportPayload(spreadsheetUrl, gid, unitKerjaId) {
    if (!unitKerjaId) throw new Error(IMPORT_UNIT_REQUIRED);
    return { spreadsheetUrl, gid, unitKerjaId };
}

// The server stops starting rows after ~25 s per part; allow for the sheet
// download, the last row and a cold start before calling a part unconfirmed.
export const IMPORT_PART_TIMEOUT_MS = 120_000;
const MAX_REPORTED_ERRORS = 20;

export function emptyImportTotals(totalRows) {
    return { success: true, totalRows, processedRows: 0, importedRows: 0, updatedRows: 0, duplicateRows: 0, skippedRows: 0, errors: [], rows: [], nextRow: 0 };
}

/**
 * Add one part of a resumable import to the running totals. A response
 * without nextRow covers the whole sheet.
 */
export function addImportPart(totals, part) {
    const totalRows = part.totalRows ?? totals.totalRows;
    const nextRow = part.nextRow ?? null;
    return {
        success: totals.success && part.success !== false,
        totalRows,
        processedRows: nextRow ?? totalRows,
        importedRows: totals.importedRows + (part.importedRows || 0),
        updatedRows: (totals.updatedRows || 0) + (part.updatedRows || 0),
        duplicateRows: totals.duplicateRows + (part.duplicateRows || 0),
        skippedRows: totals.skippedRows + (part.skippedRows || 0),
        errors: [...totals.errors, ...(part.errors || [])].slice(0, MAX_REPORTED_ERRORS),
        // Every row's outcome; an older server reports none.
        rows: [...(totals.rows || []), ...(Array.isArray(part.rows) ? part.rows : [])],
        nextRow,
        ...(nextRow === null ? {} : { prefixHash: part.prefixHash }),
    };
}
