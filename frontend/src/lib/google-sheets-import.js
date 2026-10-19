export function buildGoogleSheetsImportPayload(spreadsheetUrl, gid, unitKerjaId) {
    if (!unitKerjaId) throw new Error('Pilih unit kerja terlebih dahulu');
    return { spreadsheetUrl, gid, unitKerjaId };
}
