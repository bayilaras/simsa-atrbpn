// Legacy Drive folder columns remain in the database only for migration history.
// Private Vercel Blob is the sole canonical bitstream store, so these values are
// never exposed or accepted by the API. Works on a unit row and on a column map
// (getTableColumns), so a query can leave the columns out entirely.
export function stripDriveConfig<T extends { driveFolderId?: unknown; driveUploadFolderId?: unknown }>(
    unit: T,
): Omit<T, 'driveFolderId' | 'driveUploadFolderId'> {
    const { driveFolderId: _driveFolderId, driveUploadFolderId: _driveUploadFolderId, ...rest } = unit;
    return rest;
}
