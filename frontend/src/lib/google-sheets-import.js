export function buildGoogleSheetsImportPayload(spreadsheetUrl, sheetName, unitKerjaId) {
    if (!unitKerjaId) throw new Error('Pilih unit kerja terlebih dahulu');
    return { spreadsheetUrl, sheetName, unitKerjaId };
}
