export const ARCHIVE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export function archiveUploadError(file) {
    if (file?.type !== 'application/pdf' || !/\.pdf$/i.test(file?.name || '')) {
        return 'Hanya berkas PDF dengan nama .pdf yang diperbolehkan.';
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0) return 'Berkas PDF tidak boleh kosong.';
    if (file.size > ARCHIVE_UPLOAD_MAX_BYTES) return 'Ukuran file maksimal 10 MiB.';
    return null;
}
