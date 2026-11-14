/**
 * Direct upload bridge for private Vercel Blob storage.
 *
 * The browser obtains a scoped client token from the backend, uploads the
 * bytes straight to Blob, then waits until the server confirms the lease.
 */
import { STORAGE_PROVIDER } from '../lib/cloud-provider-config';
import { api } from './api';
import { archiveUploadError, regulatorySourceUploadError } from '../lib/archive-upload';

// Business PDFs (at most 10 MiB) get a deadline that follows the file size:
// one minute for the token and confirmation plus the transfer at an assumed
// slow 32 KiB/s, kept between two and ten minutes. A 10 MiB PDF gets about
// six and a half minutes instead of a flat two.
const BLOB_UPLOAD_MIN_TIMEOUT_MS = 2 * 60 * 1000;
const BLOB_UPLOAD_MAX_TIMEOUT_MS = 10 * 60 * 1000;
const BLOB_UPLOAD_BASE_MS = 60 * 1000;
const BLOB_UPLOAD_SLOW_BYTES_PER_SECOND = 32 * 1024;
const REGULATORY_BLOB_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const BLOB_CONFIRMATION_TIMEOUT_MS = 30 * 1000;
const RULE_SET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRegulatorySource({ folder, purpose } = {}) {
    return (purpose || (folder === 'regulatory-sources' ? 'regulatory_source' : undefined)) === 'regulatory_source';
}

// Server menolak token unggah langsung untuk nama berkas yang memuat ".." atau
// garis miring terbalik (client-upload.routes.ts); tolak lebih awal dengan
// petunjuk yang dapat diikuti.
export const PESAN_NAMA_BERKAS_TIDAK_DIDUKUNG =
    'Nama berkas tidak dapat dipakai karena memuat dua titik berurutan ("..") atau garis miring terbalik. Ganti nama berkas, lalu coba lagi.';
export const PESAN_UNGGAH_DITOLAK =
    'Berkas tidak dapat diunggah ke penyimpanan. Pastikan berkas berformat PDF, tidak melebihi batas ukuran, dan namanya tidak memuat dua titik berurutan (".."), lalu coba lagi. Jika tetap gagal, hubungi administrator.';

function regulatoryUploadError(file, options) {
    if (!RULE_SET_ID.test(options.ruleSetId || '')) return 'Versi aturan tidak dikenali. Muat ulang halaman sebelum mengunggah PDF sumber regulasi.';
    if (options.folder && options.folder !== 'regulatory-sources') return 'Tujuan unggah PDF sumber regulasi tidak valid. Muat ulang halaman, lalu coba lagi.';
    return regulatorySourceUploadError(file);
}

function directUploadError(file, options = {}) {
    const galat = isRegulatorySource(options) ? regulatoryUploadError(file, options) : archiveUploadError(file);
    if (galat) return galat;
    const nama = file?.name || '';
    return nama.includes('..') || nama.includes('\\') ? PESAN_NAMA_BERKAS_TIDAK_DIDUKUNG : null;
}

export function businessUploadTimeoutMs(sizeBytes) {
    const size = Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0;
    const estimate = BLOB_UPLOAD_BASE_MS + Math.ceil(size / BLOB_UPLOAD_SLOW_BYTES_PER_SECOND) * 1000;
    return Math.min(BLOB_UPLOAD_MAX_TIMEOUT_MS, Math.max(BLOB_UPLOAD_MIN_TIMEOUT_MS, estimate));
}

const PESAN_UNGGAH_LEWAT_WAKTU = 'Unggah berkas melewati batas waktu. Periksa koneksi internet, lalu coba unggah kembali.';
// Only business PDFs (at most 10 MiB) carry the advice to make the file smaller.
const SARAN_KECILKAN_PDF = ' Bila berkas PDF berukuran besar, kecilkan ukurannya terlebih dahulu (misalnya dengan fitur kompres PDF), lalu unggah kembali.';

function uploadTimeoutError(regulatorySource = false) {
    return Object.assign(
        new Error(regulatorySource ? PESAN_UNGGAH_LEWAT_WAKTU : PESAN_UNGGAH_LEWAT_WAKTU + SARAN_KECILKAN_PDF),
        { code: 'UPLOAD_TIMEOUT' },
    );
}

function abortError() {
    return new DOMException('Upload dibatalkan.', 'AbortError');
}

async function withUploadDeadline(operation, { signal, timeoutMs, getTimeoutError }) {
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    let interrupt;
    const interrupted = new Promise((_, reject) => { interrupt = reject; });
    const stop = (error) => {
        interrupt(error);
        // The SDK stops retries specifically for a DOMException AbortError.
        // Keep the actionable error on our race, not as fetch's abort reason.
        controller.abort(abortError());
    };
    const onAbort = () => stop(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });
    const onPolicyViolation = (event) => {
        if (event.disposition === 'report' || event.effectiveDirective !== 'connect-src') return;
        let blocked;
        try { blocked = new URL(event.blockedURI); } catch { return; }
        const isBlobRequest = blocked.protocol === 'https:' && (
            (blocked.hostname === 'vercel.com' && /^\/api\/blob(?:\/|$)/.test(blocked.pathname))
            || blocked.hostname.endsWith('.blob.vercel-storage.com')
        );
        if (!isBlobRequest) return;
        const error = new Error('Unggah berkas diblokir oleh kebijakan koneksi situs. Muat ulang halaman, lalu coba lagi. Jika tetap gagal, hubungi administrator.');
        error.code = 'UPLOAD_BLOCKED_BY_POLICY';
        stop(error);
    };
    globalThis.document?.addEventListener('securitypolicyviolation', onPolicyViolation);
    const timer = setTimeout(() => {
        const error = getTimeoutError ? getTimeoutError() : uploadTimeoutError(true);
        stop(error);
    }, timeoutMs);
    try {
        // The SDK may be waiting in retry backoff rather than in a fetch/XHR.
        // Settle the caller immediately while aborting current and future I/O.
        return await Promise.race([operation(controller.signal), interrupted]);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        globalThis.document?.removeEventListener('securitypolicyviolation', onPolicyViolation);
    }
}

function uploadConfirmationTimeout() {
    return Object.assign(new Error('Berkas sudah diunggah, tetapi server belum mengonfirmasi kesiapan penyimpanannya. Data belum disimpan. Tunggu sebentar; jika tetap terjadi, hubungi administrator.'), { code: 'UPLOAD_CONFIRMATION_TIMEOUT' });
}

export async function waitForVercelBlobReady(blobUrl, purpose, {
    apiClient = api,
    signal,
    timeoutMs = BLOB_CONFIRMATION_TIMEOUT_MS,
    sleepFn = sleep,
    now = () => Date.now(),
} = {}) {
    const deadline = now() + timeoutMs;
    return withUploadDeadline(async (confirmationSignal) => {
        let delayMs = 1000;
        while (now() < deadline) {
            confirmationSignal.throwIfAborted();
            let confirmation;
            try {
                confirmation = await apiClient.get('/api/client-upload/status', { blobUrl, purpose }, {
                    signal: confirmationSignal,
                    timeoutMs: Math.max(1, Math.min(10_000, deadline - now())),
                });
            } catch (error) {
                if (error?.code === 'REQUEST_TIMEOUT') throw uploadConfirmationTimeout();
                throw error;
            }
            confirmationSignal.throwIfAborted();
            if (now() >= deadline) throw uploadConfirmationTimeout();
            // The server checks owner, purpose, pending state and remaining
            // lease lifetime. The later record transaction still claims it.
            if (confirmation?.status === 'ready') return confirmation;
            if (confirmation?.status === 'unavailable') {
                throw Object.assign(new Error('Konfirmasi unggahan sudah tidak tersedia untuk berkas ini. Pilih kembali berkas sebelum menyimpan.'), { code: 'UPLOAD_CONFIRMATION_UNAVAILABLE' });
            }
            if (confirmation?.status !== 'waiting') {
                throw new Error('Server mengembalikan konfirmasi unggahan yang tidak valid. Data belum disimpan.');
            }
            await sleepFn(Math.min(delayMs, Math.max(0, deadline - now())), confirmationSignal);
            delayMs = 2000;
        }
        throw uploadConfirmationTimeout();
    }, { signal, timeoutMs, getTimeoutError: uploadConfirmationTimeout });
}

function sleep(delayMs, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortError());
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, delayMs);
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

async function uploadFileToVercelBlob(file, { folder = 'uploads', purpose, ruleSetId, onProgress, signal, apiClient = api } = {}) {
    const regulatorySource = isRegulatorySource({ folder, purpose });
    const resolvedPurpose = regulatorySource ? 'regulatory_source'
        : folder === 'surat-masuk' ? 'surat_masuk'
            : folder === 'surat-keluar' ? 'surat_keluar'
                : folder.startsWith('arsip-attachments/') ? 'arsip' : null;
    if (!resolvedPurpose) throw new Error('Tujuan unggahan Blob tidak didukung.');
    const pathname = regulatorySource
        ? `regulatory-sources/${ruleSetId.toLowerCase()}/${file.name}`
        : `${folder}/${file.name}`;
    const clientPayload = regulatorySource
        ? JSON.stringify({ purpose: 'regulatory-source', ruleSetId: ruleSetId.toLowerCase() })
        : undefined;
    const timeoutMs = regulatorySource ? REGULATORY_BLOB_UPLOAD_TIMEOUT_MS : businessUploadTimeoutMs(file.size);
    const deadline = Date.now() + timeoutMs;
    let waitingForConfirmation = false;
    const blob = await withUploadDeadline(async (uploadSignal) => {
        const { upload } = await import('@vercel/blob/client');
        uploadSignal.throwIfAborted();
        try {
            const uploaded = await upload(pathname, file, {
                access: 'private',
                handleUploadUrl: '/api/client-upload',
                multipart: file.size > 4 * 1024 * 1024,
                ...(clientPayload ? { clientPayload } : {}),
                abortSignal: uploadSignal,
                onUploadProgress: onProgress ? (progress) => {
                    if (!uploadSignal.aborted) onProgress(progress);
                } : undefined,
            });
            waitingForConfirmation = true;
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) throw uploadConfirmationTimeout();
            await waitForVercelBlobReady(uploaded.url, resolvedPurpose, {
                apiClient,
                signal: uploadSignal,
                timeoutMs: Math.min(BLOB_CONFIRMATION_TIMEOUT_MS, remainingMs),
            });
            return uploaded;
        } catch (error) {
            if (uploadSignal.aborted) throw uploadSignal.reason;
            if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) {
                const connectionError = new Error('Unggah berkas gagal terhubung ke penyimpanan. Periksa koneksi internet dan muat ulang halaman sebelum mencoba lagi.');
                connectionError.code = 'UPLOAD_CONNECTION_FAILED';
                throw connectionError;
            }
            // Galat SDK penyimpanan berbahasa Inggris ("Vercel Blob: ..."); staf melihat pesan Indonesia.
            if (/^Vercel Blob:/.test(error?.message || '')) {
                throw Object.assign(new Error(PESAN_UNGGAH_DITOLAK, { cause: error }), { code: 'UPLOAD_REJECTED' });
            }
            throw error;
        }
    }, {
        signal, timeoutMs,
        getTimeoutError: () => waitingForConfirmation ? uploadConfirmationTimeout() : uploadTimeoutError(regulatorySource),
    });

    return {
        url: blob.url,
        downloadUrl: blob.downloadUrl,
        pathname: blob.pathname,
    };
}

export async function uploadFileToBlob(file, options = {}) {
    const validationError = directUploadError(file, options);
    if (validationError) throw new Error(validationError);
    if (STORAGE_PROVIDER === 'disabled') {
        throw new Error('Unggah berkas dinonaktifkan pada deployment ini.');
    }
    return uploadFileToVercelBlob(file, options);
}

export default { uploadFileToBlob };
