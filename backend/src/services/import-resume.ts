import { createHash } from 'node:crypto';
import { ConflictError } from '../utils/errors.js';

/**
 * A resumable import request stops starting new rows after this long. With
 * the sheet download and one last row it stays far inside the 300 s function
 * limit, and at most ~2.4 requests per minute fit the 3/min import quota.
 */
export const IMPORT_TIME_BUDGET_MS = 25_000;

/** Where a resumable import request starts, and when it stops starting rows. */
export interface ImportResume {
    startRow: number;
    /** importPrefixHash of the rows before startRow, as returned by the previous part. */
    prefixHash?: string;
    deadlineAt: number;
}

/** Digest of the source rows before `end`, so a later part can prove they are still the same rows. */
export function importPrefixHash(rows: readonly unknown[], end: number): string {
    return createHash('sha256').update(JSON.stringify(rows.slice(0, end))).digest('hex');
}

/**
 * A continuation is only safe when every row before its start is unchanged:
 * an inserted, removed or edited earlier row would shift positions and could
 * skip a row silently. Appended rows and rows after the start may change.
 */
export function assertImportResumable(rows: readonly unknown[], resume: ImportResume): void {
    if (resume.startRow > rows.length
        || (resume.startRow > 0 && importPrefixHash(rows, resume.startRow) !== resume.prefixHash)) {
        throw new ConflictError('Isi sumber impor berubah sejak bagian sebelumnya, sehingga posisi lanjutan tidak dapat dipastikan. '
            + 'Baris yang sudah tersimpan tetap tercatat. Jalankan impor lagi dari awal; baris tersebut akan dikenali sebagai duplikat.');
    }
}
