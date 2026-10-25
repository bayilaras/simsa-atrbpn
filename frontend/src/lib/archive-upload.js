export const ARCHIVE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const REGULATORY_SOURCE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

function pdfUploadError(file, maximumBytes, sizeError) {
    if (file?.type !== 'application/pdf' || !/\.pdf$/i.test(file?.name || '')) {
        return 'Hanya berkas PDF dengan nama .pdf yang diperbolehkan.';
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0) return 'Berkas PDF tidak boleh kosong.';
    if (file.size > maximumBytes) return sizeError;
    return null;
}

export function archiveUploadError(file) {
    return pdfUploadError(file, ARCHIVE_UPLOAD_MAX_BYTES, 'Ukuran file maksimal 10 MiB.');
}

export function regulatorySourceUploadError(file) {
    return pdfUploadError(file, REGULATORY_SOURCE_UPLOAD_MAX_BYTES, 'Ukuran PDF sumber regulasi maksimal 50 MiB.');
}
