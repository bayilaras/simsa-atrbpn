/**
 * Direct upload bridge for private Vercel Blob storage.
 *
 * The browser obtains a scoped client token from the backend, uploads the
 * bytes straight to Blob, then waits until the server confirms the lease.
 */
import { STORAGE_PROVIDER } from '../lib/cloud-provider-config';
import { api } from './api';
import { archiveUploadError, regulatorySourceUploadError } from '../lib/archive-upload';

const BLOB_UPLOAD_TIMEOUT_MS = 2 * 60 * 1000;
const REGULATORY_BLOB_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const BLOB_CONFIRMATION_TIMEOUT_MS = 30 * 1000;
const RULE_SET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRegulatorySource({ folder, purpose } = {}) {
    return (purpose || (folder === 'regulatory-sources' ? 'regulatory_source' : undefined)) === 'regulatory_source';
}

function directUploadError(file, options = {}) {
    if (!isRegulatorySource(options)) return archiveUploadError(file);
    if (!RULE_SET_ID.test(options.ruleSetId || '')) return 'ruleSetId yang valid wajib untuk upload dokumen sumber regulasi.';
    if (options.folder && options.folder !== 'regulatory-sources') return 'Folder PDF sumber harus regulatory-sources.';
    return regulatorySourceUploadError(file);
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
        const error = getTimeoutError ? getTimeoutError()
            : Object.assign(new Error('Unggah berkas melewati batas waktu. Periksa koneksi internet, lalu coba unggah kembali.'), { code: 'UPLOAD_TIMEOUT' });
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
    const timeoutMs = regulatorySource ? REGULATORY_BLOB_UPLOAD_TIMEOUT_MS : BLOB_UPLOAD_TIMEOUT_MS;
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
            throw error;
        }
    }, {
        signal, timeoutMs,
        getTimeoutError: () => waitingForConfirmation ? uploadConfirmationTimeout()
            : Object.assign(new Error('Unggah berkas melewati batas waktu. Periksa koneksi internet, lalu coba unggah kembali.'), { code: 'UPLOAD_TIMEOUT' }),
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
        throw new Error('Unggah berkas dinonaktifkan pada demo metadata.');
    }
    return uploadFileToVercelBlob(file, options);
}

export default { uploadFileToBlob };
