/**
 * Provider-aware direct upload bridge.
 *
 * Vercel Blob remains the default rollback path. In GCS mode the browser asks
 * the backend for a short-lived resumable session, uploads without application
 * credentials, then waits for Eventarc to mark the lease pending/claimable.
 */
import { STORAGE_PROVIDER } from '../lib/cloud-provider-config';
import { api } from './api';

const GCS_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const GCS_FINALIZATION_TIMEOUT_MS = 60 * 1000;
const GCS_HOSTS = new Set(['storage.googleapis.com', 'www.googleapis.com']);
const GCS_PURPOSES = new Set(['surat_masuk', 'surat_keluar', 'regulatory_source']);
const TERMINAL_UNCLAIMABLE_STATUSES = new Set([
    'cleanup_started',
    'release_cleanup',
    'deleted',
    'claimed',
]);

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
        const lease = await apiClient.get(`/api/object-uploads/${encodeURIComponent(uploadId)}`);
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
    if (!file?.name || !Number.isSafeInteger(file.size) || file.size <= 0) {
        throw new Error('Berkas upload GCS harus memiliki nama dan ukuran positif.');
    }
    if (resolvedPurpose === 'regulatory_source' && !ruleSetId) {
        throw new Error('ruleSetId wajib untuk upload dokumen sumber regulasi.');
    }
    const intent = await apiClient.post('/api/object-uploads', {
        purpose: resolvedPurpose,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        ...(resolvedPurpose === 'regulatory_source' ? { ruleSetId } : {}),
    });

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

async function uploadFileToVercelBlob(file, { folder = 'uploads', purpose, ruleSetId, onProgress } = {}) {
    const { upload } = await import('@vercel/blob/client');
    const pathname = `${folder}/${file.name}`;
    const clientPayload = purpose === 'regulatory_source'
        ? JSON.stringify({ purpose: 'regulatory-source', ruleSetId })
        : undefined;
    const blob = await upload(pathname, file, {
        access: 'private',
        handleUploadUrl: '/api/client-upload',
        multipart: file.size > 4 * 1024 * 1024,
        ...(clientPayload ? { clientPayload } : {}),
        onUploadProgress: onProgress,
    });

    return {
        url: blob.url,
        downloadUrl: blob.downloadUrl,
        pathname: blob.pathname,
    };
}

export async function uploadFileToBlob(file, options = {}) {
    if (STORAGE_PROVIDER === 'gcs') return uploadFileToGcs(file, options);
    return uploadFileToVercelBlob(file, options);
}

export default { uploadFileToBlob };
