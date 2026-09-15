/**
 * Provider-aware direct upload bridge.
 *
 * Vercel Blob remains the default rollback path. In GCS mode the browser asks
 * the backend for a short-lived resumable session, uploads without application
 * credentials, then waits for Eventarc to mark the lease pending/claimable.
 */
import { STORAGE_PROVIDER } from '../lib/cloud-provider-config';
import { api } from './api';
import { archiveUploadError, regulatorySourceUploadError } from '../lib/archive-upload';

const GCS_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const GCS_FINALIZATION_TIMEOUT_MS = 60 * 1000;
const BLOB_UPLOAD_TIMEOUT_MS = 2 * 60 * 1000;
const REGULATORY_BLOB_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const BLOB_CONFIRMATION_TIMEOUT_MS = 30 * 1000;
const GCS_HOSTS = new Set(['storage.googleapis.com', 'www.googleapis.com']);
const GCS_PURPOSES = new Set(['surat_masuk', 'surat_keluar', 'regulatory_source']);
const RULE_SET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_UNCLAIMABLE_STATUSES = new Set([
    'cleanup_started',
    'release_cleanup',
    'deleted',
    'claimed',
]);

function isRegulatorySource({ folder, purpose } = {}) {
    return (purpose || (folder === 'regulatory-sources' ? 'regulatory_source' : undefined)) === 'regulatory_source';
}

function directUploadError(file, options = {}) {
    if (!isRegulatorySource(options)) return archiveUploadError(file);
    if (!RULE_SET_ID.test(options.ruleSetId || '')) return 'ruleSetId yang valid wajib untuk upload dokumen sumber regulasi.';
    if (options.folder && options.folder !== 'regulatory-sources') return 'Folder PDF sumber harus regulatory-sources.';
    return regulatorySourceUploadError(file);
}

export function resolveGcsUploadPurpose({ folder, purpose } = {}) {
    const inferred = purpose || ({
        'surat-masuk': 'surat_masuk',
        'surat-keluar': 'surat_keluar',
        'regulatory-sources': 'regulatory_source',
    }[folder]);

    if (!GCS_PURPOSES.has(inferred)) {
        throw new Error(`Tujuan upload GCS tidak didukung untuk folder "${folder || ''}".`);
    }
    return inferred;
}

export function assertTrustedGcsSessionUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error('Backend mengembalikan URL sesi upload GCS yang tidak valid.');
    }

    if (url.protocol !== 'https:' || !GCS_HOSTS.has(url.hostname)) {
        throw new Error('Backend mengembalikan host sesi upload GCS yang tidak dipercaya.');
    }
    return url.toString();
}

function safeGcsHeaders(requiredHeaders = {}) {
    const entries = Object.entries(requiredHeaders);
    for (const [name] of entries) {
        if (name.toLowerCase() !== 'content-type') {
            throw new Error(`Header upload GCS tidak diizinkan: ${name}.`);
        }
    }
    return entries;
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

export function uploadToGcsSession(
    sessionUrl,
    file,
    { requiredHeaders = {}, onProgress, signal, xhrFactory = () => new XMLHttpRequest() } = {},
) {
    const trustedUrl = assertTrustedGcsSessionUrl(sessionUrl);
    const headers = safeGcsHeaders(requiredHeaders);

    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortError());
            return;
        }

        const xhr = xhrFactory();
        const cleanup = () => signal?.removeEventListener('abort', onAbort);
        const onAbort = () => xhr.abort();

        xhr.open('PUT', trustedUrl, true);
        xhr.withCredentials = false;
        xhr.timeout = GCS_UPLOAD_TIMEOUT_MS;
        for (const [name, value] of headers) xhr.setRequestHeader(name, value);

        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable || !onProgress) return;
            onProgress({
                loaded: event.loaded,
                total: event.total,
                percentage: event.total ? (event.loaded / event.total) * 100 : 0,
            });
        };
        xhr.onload = () => {
            cleanup();
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Upload GCS gagal dengan status HTTP ${xhr.status}.`));
        };
        xhr.onerror = () => {
            cleanup();
            reject(new Error('Upload langsung ke GCS gagal karena gangguan jaringan atau CORS.'));
        };
        xhr.ontimeout = () => {
            cleanup();
            reject(new Error('Upload langsung ke GCS melewati batas waktu.'));
        };
        xhr.onabort = () => {
            cleanup();
            reject(abortError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        xhr.send(file);
    });
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

export async function waitForPendingUpload(
    uploadId,
    {
        apiClient = api,
        signal,
        timeoutMs = GCS_FINALIZATION_TIMEOUT_MS,
        sleepFn = sleep,
        now = () => Date.now(),
    } = {},
) {
    const deadline = now() + timeoutMs;
    let delayMs = 250;

    while (now() < deadline) {
        if (signal?.aborted) throw abortError();
        const lease = await apiClient.get(`/api/object-uploads/${encodeURIComponent(uploadId)}`, undefined, { signal });
        if (signal?.aborted) throw abortError();
        if (lease?.status === 'pending') return lease;
        if (TERMINAL_UNCLAIMABLE_STATUSES.has(lease?.status)) {
            throw new Error(`Lease upload tidak dapat diklaim (status: ${lease.status}).`);
        }
        if (lease?.expiresAt && new Date(lease.expiresAt).getTime() <= now()) {
            throw new Error('Lease upload GCS kedaluwarsa sebelum finalisasi terverifikasi.');
        }
        await sleepFn(delayMs, signal);
        delayMs = Math.min(delayMs * 2, 2000);
    }

    throw new Error('Finalisasi upload belum terkonfirmasi oleh Eventarc dalam batas waktu.');
}

export async function uploadFileToGcs(file, {
    folder,
    purpose,
    ruleSetId,
    onProgress,
    signal,
    apiClient = api,
    uploadTransport = uploadToGcsSession,
    waitForPending = waitForPendingUpload,
} = {}) {
    const resolvedPurpose = resolveGcsUploadPurpose({ folder, purpose });
    const validationError = directUploadError(file, { folder, purpose: resolvedPurpose, ruleSetId });
    if (validationError) throw new Error(validationError);
    if (!file?.name || !Number.isSafeInteger(file.size) || file.size <= 0) {
        throw new Error('Berkas upload GCS harus memiliki nama dan ukuran positif.');
    }
    if (resolvedPurpose === 'regulatory_source' && !ruleSetId) {
        throw new Error('ruleSetId wajib untuk upload dokumen sumber regulasi.');
    }
    if (signal?.aborted) throw abortError();
    const intent = await apiClient.post('/api/object-uploads', {
        purpose: resolvedPurpose,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        ...(resolvedPurpose === 'regulatory_source' ? { ruleSetId } : {}),
    }, { signal });

    if (signal?.aborted) throw abortError();

    if (!intent?.uploadId || !intent?.locator || !intent?.resumableSessionUri) {
        throw new Error('Backend tidak mengembalikan intent upload GCS yang lengkap.');
    }

    await uploadTransport(intent.resumableSessionUri, file, {
        requiredHeaders: intent.requiredHeaders,
        onProgress,
        signal,
    });
    const lease = await waitForPending(intent.uploadId, { apiClient, signal });

    return {
        url: intent.locator,
        downloadUrl: intent.locator,
        pathname: intent.locator,
        uploadId: intent.uploadId,
        status: lease.status,
    };
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
    if (STORAGE_PROVIDER === 'gcs') return uploadFileToGcs(file, options);
    return uploadFileToVercelBlob(file, options);
}

export default { uploadFileToBlob };
