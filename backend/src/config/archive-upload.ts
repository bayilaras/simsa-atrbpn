import { PayloadTooLargeError, ValidationError } from '../utils/errors.js';

export const ARCHIVE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
// Official regulation PDFs may include hundreds of scanned annex pages.
// Business correspondence retains the separate 10 MiB limit above.
export const REGULATORY_SOURCE_MAX_BYTES = 50 * 1024 * 1024;
export const ARCHIVE_UPLOAD_MIME = 'application/pdf';

export function isPdfUploadMetadata(fileName: string, mimeType: string): boolean {
    return mimeType === ARCHIVE_UPLOAD_MIME && /\.pdf$/i.test(fileName);
}

/** Header validation complements, and never replaces, quarantine and antivirus. */
export function assertPdfUpload(fileName: string, mimeType: string, sizeBytes: number, prefix: Buffer): void {
    if (sizeBytes > ARCHIVE_UPLOAD_MAX_BYTES) throw new PayloadTooLargeError('Lampiran melebihi batas 10 MiB.');
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0
        || !isPdfUploadMetadata(fileName, mimeType)
        || !prefix.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new ValidationError('Berkas harus PDF dengan nama .pdf, MIME application/pdf, dan signature PDF yang valid.');
    }
}
