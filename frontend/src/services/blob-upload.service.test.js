import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    assertTrustedGcsSessionUrl,
    resolveGcsUploadPurpose,
    uploadFileToGcs,
    uploadFileToBlob,
    waitForPendingUpload,
    waitForVercelBlobReady,
} from './blob-upload.service';

const blobSdk = vi.hoisted(() => ({ upload: vi.fn(), getStatus: vi.fn() }));
vi.mock('@vercel/blob/client', () => blobSdk);
vi.mock('./api', () => ({ api: { get: blobSdk.getStatus } }));
vi.mock('../lib/cloud-provider-config', () => ({ STORAGE_PROVIDER: 'vercel-blob', USE_FIREBASE_AUTH: false }));
const ruleSetId = '08002020-0800-4080-8080-000000000008';

beforeEach(() => {
    blobSdk.getStatus.mockReset();
    blobSdk.getStatus.mockResolvedValue({ status: 'ready', expiresAt: '2040-01-01T00:00:00.000Z' });
});

describe('GCS direct upload bridge', () => {
    it.each([
        { name: 'arsip.pdf', type: 'application/pdf', size: 10_485_761 },
        { name: 'arsip.exe', type: 'application/pdf', size: 10 },
        { name: 'arsip.pdf', type: 'image/png', size: 10 },
        { name: 'arsip.pdf', type: 'application/pdf', size: 0 },
    ])('does not request storage authorization for an invalid PDF: %j', async file => {
        const apiClient = { post: vi.fn() };
        const uploadTransport = vi.fn();
        await expect(uploadFileToGcs(file, { purpose: 'surat_masuk', apiClient, uploadTransport })).rejects.toThrow();
        expect(apiClient.post).not.toHaveBeenCalled();
        expect(uploadTransport).not.toHaveBeenCalled();
    });
    it('maps existing business folders to backend upload purposes', () => {
        expect(resolveGcsUploadPurpose({ folder: 'surat-masuk' })).toBe('surat_masuk');
        expect(resolveGcsUploadPurpose({ folder: 'surat-keluar' })).toBe('surat_keluar');
        expect(resolveGcsUploadPurpose({ purpose: 'regulatory_source' })).toBe('regulatory_source');
        expect(() => resolveGcsUploadPurpose({ folder: 'misc' })).toThrow(/tidak didukung/);
    });

    it('accepts only HTTPS Google Storage resumable session hosts', () => {
        expect(assertTrustedGcsSessionUrl('https://storage.googleapis.com/upload/storage/v1/b/x'))
            .toMatch(/^https:\/\/storage\.googleapis\.com/);
        expect(() => assertTrustedGcsSessionUrl('https://storage.googleapis.com.evil.example/upload'))
            .toThrow(/tidak dipercaya/);
        expect(() => assertTrustedGcsSessionUrl('http://storage.googleapis.com/upload'))
            .toThrow(/tidak dipercaya/);
    });

    it('creates an intent, uploads directly, and returns only a pending lease', async () => {
        const apiClient = {
            post: vi.fn().mockResolvedValue({
                uploadId: 'upload-id',
                locator: 'gcs://private-bucket/object.pdf#1',
                resumableSessionUri: 'https://storage.googleapis.com/upload/storage/v1/b/private-bucket',
                requiredHeaders: { 'Content-Type': 'application/pdf' },
            }),
        };
        const uploadTransport = vi.fn().mockResolvedValue(undefined);
        const waitForPending = vi.fn().mockResolvedValue({ status: 'pending' });
        const file = new File(['pdf'], 'source.pdf', { type: 'application/pdf' });

        await expect(uploadFileToGcs(file, {
            purpose: 'regulatory_source',
            ruleSetId,
            apiClient,
            uploadTransport,
            waitForPending,
        })).resolves.toEqual({
            url: 'gcs://private-bucket/object.pdf#1',
            downloadUrl: 'gcs://private-bucket/object.pdf#1',
            pathname: 'gcs://private-bucket/object.pdf#1',
            uploadId: 'upload-id',
            status: 'pending',
        });
        expect(apiClient.post).toHaveBeenCalledWith('/api/object-uploads', {
            purpose: 'regulatory_source',
            fileName: 'source.pdf',
            contentType: 'application/pdf',
            sizeBytes: file.size,
            ruleSetId,
        }, { signal: undefined });
        expect(uploadTransport).toHaveBeenCalledOnce();
        expect(waitForPending).toHaveBeenCalledWith('upload-id', {
            apiClient,
            signal: undefined,
        });
    });

    it('polls until Eventarc marks an authorized upload pending', async () => {
        const apiClient = {
            get: vi.fn()
                .mockResolvedValueOnce({ status: 'authorized' })
                .mockResolvedValueOnce({ status: 'pending' }),
        };
        const sleepFn = vi.fn().mockResolvedValue(undefined);

        await expect(waitForPendingUpload('upload-id', {
            apiClient,
            sleepFn,
            now: () => 1,
        })).resolves.toEqual({ status: 'pending' });
        expect(apiClient.get).toHaveBeenCalledTimes(2);
        expect(sleepFn).toHaveBeenCalledOnce();
    });
});

describe('regulatory source direct-upload scope', () => {
    beforeEach(() => {
        blobSdk.upload.mockReset();
        blobSdk.upload.mockResolvedValue({ url: 'private-object', pathname: 'private-path' });
    });

    it('sends exactly 50 MiB using a rule-bound Vercel pathname and regulatory token purpose', async () => {
        const file = { name: 'peraturan.pdf', type: 'application/pdf', size: 52_428_800 };
        await uploadFileToBlob(file, { folder: 'regulatory-sources', purpose: 'regulatory_source', ruleSetId });
        expect(blobSdk.upload).toHaveBeenCalledWith(`regulatory-sources/${ruleSetId}/peraturan.pdf`, file, expect.objectContaining({
            access: 'private', multipart: true, handleUploadUrl: '/api/client-upload',
            clientPayload: JSON.stringify({ purpose: 'regulatory-source', ruleSetId }),
        }));
    });

    it('rejects an oversized regulatory source before requesting a Vercel token', async () => {
        await expect(uploadFileToBlob({ name: 'peraturan.pdf', type: 'application/pdf', size: 52_428_801 }, {
            purpose: 'regulatory_source', ruleSetId,
        })).rejects.toThrow('50 MiB');
        expect(blobSdk.upload).not.toHaveBeenCalled();
    });

    it.each([
        { purpose: 'regulatory_source' },
        { purpose: 'regulatory_source', ruleSetId: '../other' },
        { purpose: 'regulatory_source', ruleSetId, folder: 'surat-masuk' },
    ])('requires a valid rule binding and regulatory folder before token authorization: %j', async options => {
        await expect(uploadFileToBlob({ name: 'peraturan.pdf', type: 'application/pdf', size: 52_428_800 }, options)).rejects.toThrow();
        expect(blobSdk.upload).not.toHaveBeenCalled();
    });

    it.each([{ folder: 'surat-masuk' }, { folder: 'surat-keluar' }, { folder: 'arsip-attachments/id' }])(
        'keeps the 10 MiB cap for business uploads: %j', async options => {
            await expect(uploadFileToBlob({ name: 'arsip.pdf', type: 'application/pdf', size: 10_485_761 }, options))
                .rejects.toThrow('10 MiB');
            expect(blobSdk.upload).not.toHaveBeenCalled();
        },
    );

    it('accepts 50 MiB only as a bound GCS regulatory intent', async () => {
        const apiClient = { post: vi.fn().mockResolvedValue({ uploadId: 'upload-id', locator: 'private-locator', resumableSessionUri: 'https://storage.googleapis.com/upload' }) };
        const uploadTransport = vi.fn().mockResolvedValue(undefined);
        const waitForPending = vi.fn().mockResolvedValue({ status: 'pending' });
        const file = { name: 'peraturan.pdf', type: 'application/pdf', size: 52_428_800 };
        await uploadFileToGcs(file, { purpose: 'regulatory_source', ruleSetId, apiClient, uploadTransport, waitForPending });
        expect(apiClient.post).toHaveBeenCalledWith('/api/object-uploads', expect.objectContaining({ purpose: 'regulatory_source', ruleSetId, sizeBytes: 52_428_800 }), { signal: undefined });
        expect(uploadTransport).toHaveBeenCalledOnce();
    });

    it('rejects one byte above 50 MiB before asking for a GCS intent', async () => {
        const apiClient = { post: vi.fn() };
        await expect(uploadFileToGcs({ name: 'peraturan.pdf', type: 'application/pdf', size: 52_428_801 }, {
            purpose: 'regulatory_source', ruleSetId, apiClient,
        })).rejects.toThrow('50 MiB');
        expect(apiClient.post).not.toHaveBeenCalled();
    });
});

describe('bounded upload cancellation and failure recovery', () => {
    const file = new File(['pdf'], 'surat.pdf', { type: 'application/pdf' });

    beforeEach(() => {
        blobSdk.upload.mockReset();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not request a client token when the caller already cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(uploadFileToBlob(file, { folder: 'surat-masuk', signal: controller.signal }))
            .rejects.toMatchObject({ name: 'AbortError', message: 'Upload dibatalkan.' });
        expect(blobSdk.upload).not.toHaveBeenCalled();
    });

    it('aborts the SDK and settles while its retry backoff is still pending', async () => {
        vi.useFakeTimers();
        blobSdk.upload.mockReturnValue(new Promise(() => {}));
        const controller = new AbortController();
        const progress = vi.fn();
        const pending = uploadFileToBlob(file, { folder: 'surat-masuk', signal: controller.signal, onProgress: progress });
        const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        await vi.dynamicImportSettled();
        const options = blobSdk.upload.mock.calls[0][2];
        expect(options.abortSignal.aborted).toBe(false);
        expect(options.access).toBe('private');
        controller.abort();
        await rejection;
        expect(options.abortSignal.aborted).toBe(true);
        options.onUploadProgress({ percentage: 100 });
        expect(progress).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('ends a stalled business upload after two minutes without starting another upload', async () => {
        vi.useFakeTimers();
        blobSdk.upload.mockReturnValue(new Promise(() => {}));
        const pending = uploadFileToBlob(file, { folder: 'surat-masuk' });
        const rejection = expect(pending).rejects.toMatchObject({ code: 'UPLOAD_TIMEOUT', message: expect.stringContaining('Periksa koneksi internet') });
        await vi.dynamicImportSettled();
        const sdkSignal = blobSdk.upload.mock.calls[0][2].abortSignal;
        await vi.advanceTimersByTimeAsync(120_000);
        await rejection;
        expect(sdkSignal.aborted).toBe(true);
        expect(blobSdk.upload).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('fails fast for an enforced Blob CSP block and ignores unrelated or report-only violations', async () => {
        vi.useFakeTimers();
        blobSdk.upload.mockReturnValue(new Promise(() => {}));
        const pending = uploadFileToBlob(file, { folder: 'surat-masuk' });
        const rejection = expect(pending).rejects.toMatchObject({ code: 'UPLOAD_BLOCKED_BY_POLICY' });
        await vi.dynamicImportSettled();
        const sdkSignal = blobSdk.upload.mock.calls[0][2].abortSignal;
        const violation = (overrides = {}) => document.dispatchEvent(Object.assign(new Event('securitypolicyviolation'), {
            disposition: 'enforce', effectiveDirective: 'connect-src', blockedURI: 'https://vercel.com/api/blob/?pathname=surat-masuk%2Fsurat.pdf', ...overrides,
        }));
        violation({ disposition: 'report' });
        violation({ blockedURI: 'https://vercel.com/api/unrelated' });
        violation({ blockedURI: 'https://vercel.com.evil.example/api/blob/' });
        violation({ effectiveDirective: 'img-src' });
        expect(sdkSignal.aborted).toBe(false);
        violation();
        await rejection;
        expect(sdkSignal.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('uses the SDK-recognized AbortError to stop retries while returning the actionable timeout', async () => {
        vi.useFakeTimers();
        blobSdk.upload.mockImplementation((_pathname, _file, options) => new Promise((_, reject) => {
            options.abortSignal.addEventListener('abort', () => reject(options.abortSignal.reason), { once: true });
        }));
        const pending = uploadFileToBlob(file, { folder: 'surat-masuk' });
        const rejection = expect(pending).rejects.toMatchObject({ code: 'UPLOAD_TIMEOUT' });
        await vi.dynamicImportSettled();
        await vi.advanceTimersByTimeAsync(120_000);
        await rejection;
        const reason = blobSdk.upload.mock.calls[0][2].abortSignal.reason;
        expect(reason).toBeInstanceOf(DOMException);
        expect(reason.name).toBe('AbortError');
        expect(blobSdk.upload).toHaveBeenCalledOnce();
    });

    it('gives larger regulatory PDFs ten minutes while keeping a finite deadline', async () => {
        vi.useFakeTimers();
        blobSdk.upload.mockReturnValue(new Promise(() => {}));
        let settled = false;
        const pending = uploadFileToBlob(file, { folder: 'regulatory-sources', ruleSetId })
            .finally(() => { settled = true; });
        const rejection = expect(pending).rejects.toMatchObject({ code: 'UPLOAD_TIMEOUT' });
        await vi.dynamicImportSettled();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(480_000);
        await rejection;
        expect(blobSdk.upload.mock.calls[0][2].abortSignal.aborted).toBe(true);
    });

    it('releases its deadline and abort listener after successful private upload', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
        const progress = vi.fn();
        blobSdk.upload.mockImplementation(async (_pathname, _file, options) => {
            options.onUploadProgress({ percentage: 100 });
            return { url: 'private-url', downloadUrl: 'private-download', pathname: 'private-path' };
        });
        await expect(uploadFileToBlob(file, { folder: 'surat-keluar', signal: controller.signal, onProgress: progress }))
            .resolves.toEqual({ url: 'private-url', downloadUrl: 'private-download', pathname: 'private-path' });
        expect(progress).toHaveBeenCalledWith({ percentage: 100 });
        expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
        expect(vi.getTimerCount()).toBe(0);
        controller.abort();
        expect(blobSdk.upload.mock.calls[0][2].abortSignal.aborted).toBe(false);
    });

    it('reports a network failure with recovery instructions and preserves specific authorization errors', async () => {
        blobSdk.upload.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await expect(uploadFileToBlob(file, { folder: 'surat-masuk' }))
            .rejects.toMatchObject({ code: 'UPLOAD_CONNECTION_FAILED', message: expect.stringContaining('muat ulang halaman') });
        const denied = new Error('Vercel Blob: This token does not have access to this store.');
        blobSdk.upload.mockRejectedValueOnce(denied);
        await expect(uploadFileToBlob(file, { folder: 'surat-masuk' })).rejects.toBe(denied);
    });

    it('forwards cancellation to GCS intent and lease polling before any storage transfer', async () => {
        const controller = new AbortController();
        const apiClient = { post: vi.fn().mockImplementation(async () => {
            controller.abort();
            return { uploadId: 'lease', locator: 'private-locator', resumableSessionUri: 'https://storage.googleapis.com/upload' };
        }), get: vi.fn() };
        const uploadTransport = vi.fn();
        await expect(uploadFileToGcs(file, { folder: 'surat-masuk', signal: controller.signal, apiClient, uploadTransport }))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(apiClient.post).toHaveBeenCalledWith('/api/object-uploads', expect.any(Object), { signal: controller.signal });
        expect(uploadTransport).not.toHaveBeenCalled();

        const pollController = new AbortController();
        apiClient.get.mockImplementation(async () => { pollController.abort(); return { status: 'pending' }; });
        await expect(waitForPendingUpload('lease', { apiClient, signal: pollController.signal }))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(apiClient.get).toHaveBeenCalledWith('/api/object-uploads/lease', undefined, { signal: pollController.signal });
    });
});

describe('Vercel signed-callback readiness', () => {
    const locator = 'https://private.blob.vercel-storage.com/surat-masuk/surat-random.pdf';
    const file = new File(['pdf'], 'surat.pdf', { type: 'application/pdf' });

    beforeEach(() => {
        vi.useFakeTimers();
        blobSdk.upload.mockReset();
        blobSdk.upload.mockResolvedValue({ url: locator, pathname: 'surat-masuk/surat-random.pdf', downloadUrl: locator });
    });
    afterEach(() => vi.useRealTimers());

    it('holds the original SDK result until a delayed owned callback becomes ready without another upload', async () => {
        blobSdk.getStatus.mockResolvedValueOnce({ status: 'waiting' }).mockResolvedValueOnce({ status: 'waiting' });
        let settled = false;
        const pending = uploadFileToBlob(file, { folder: 'surat-masuk' }).then(result => { settled = true; return result; });
        await vi.dynamicImportSettled();
        expect(blobSdk.getStatus).toHaveBeenCalledOnce();
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(999);
        expect(blobSdk.getStatus).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(blobSdk.getStatus).toHaveBeenCalledTimes(2);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(2000);
        await expect(pending).resolves.toEqual({ url: locator, pathname: 'surat-masuk/surat-random.pdf', downloadUrl: locator });
        expect(blobSdk.upload).toHaveBeenCalledOnce();
        expect(blobSdk.getStatus).toHaveBeenLastCalledWith('/api/client-upload/status', { blobUrl: locator, purpose: 'surat_masuk' }, {
            signal: expect.any(AbortSignal), timeoutMs: 10_000,
        });
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['callback not received', 'locator unavailable to this owner'])('bounds waiting for %s and reports unconfirmed storage without uploading again', async () => {
        const callsAt = [];
        blobSdk.getStatus.mockImplementation(async () => { callsAt.push(Date.now()); return { status: 'waiting' }; });
        const pending = uploadFileToBlob(file, { folder: 'surat-masuk' });
        const rejection = expect(pending).rejects.toMatchObject({ code: 'UPLOAD_CONFIRMATION_TIMEOUT', message: expect.stringContaining('Data belum disimpan') });
        await vi.dynamicImportSettled();
        await vi.advanceTimersByTimeAsync(30_000);
        await rejection;
        expect(blobSdk.upload).toHaveBeenCalledOnce();
        expect(callsAt.length).toBeLessThanOrEqual(16);
        expect(callsAt.slice(1).every((time, index) => time - callsAt[index] >= 1000)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['expired', 'claimed'])('stops immediately when the server marks an owned %s lease unavailable', async () => {
        blobSdk.getStatus.mockResolvedValue({ status: 'unavailable' });
        await expect(uploadFileToBlob(file, { folder: 'surat-masuk' }))
            .rejects.toMatchObject({ code: 'UPLOAD_CONFIRMATION_UNAVAILABLE' });
        expect(blobSdk.getStatus).toHaveBeenCalledOnce();
        expect(blobSdk.upload).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels a stalled status request and does not continue polling after the caller leaves', async () => {
        blobSdk.getStatus.mockReturnValue(new Promise(() => {}));
        const controller = new AbortController();
        const pending = uploadFileToBlob(file, { folder: 'surat-masuk', signal: controller.signal });
        const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        await vi.dynamicImportSettled();
        const statusSignal = blobSdk.getStatus.mock.calls[0][2].signal;
        controller.abort();
        await rejection;
        expect(statusSignal.aborted).toBe(true);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(blobSdk.getStatus).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps confirmation inside the existing two-minute total upload deadline', async () => {
        blobSdk.upload.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ url: locator, pathname: 'surat-masuk/surat-random.pdf' }), 115_000)));
        blobSdk.getStatus.mockResolvedValue({ status: 'waiting' });
        const pending = uploadFileToBlob(file, { folder: 'surat-masuk' });
        const rejection = expect(pending).rejects.toMatchObject({ code: 'UPLOAD_CONFIRMATION_TIMEOUT' });
        await vi.dynamicImportSettled();
        await vi.advanceTimersByTimeAsync(115_000);
        expect(blobSdk.getStatus).toHaveBeenCalledWith('/api/client-upload/status', { blobUrl: locator, purpose: 'surat_masuk' }, {
            signal: expect.any(AbortSignal), timeoutMs: 5000,
        });
        await vi.advanceTimersByTimeAsync(5000);
        await rejection;
        expect(blobSdk.upload).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not treat a malformed response or an API deadline as a confirmed lease', async () => {
        blobSdk.getStatus.mockResolvedValueOnce({ status: 'pending' });
        await expect(waitForVercelBlobReady(locator, 'surat_masuk')).rejects.toThrow('tidak valid');
        blobSdk.getStatus.mockRejectedValueOnce(Object.assign(new Error('Request timed out'), { code: 'REQUEST_TIMEOUT' }));
        await expect(waitForVercelBlobReady(locator, 'surat_masuk'))
            .rejects.toMatchObject({ code: 'UPLOAD_CONFIRMATION_TIMEOUT' });
    });

    it.each([
        [{ folder: 'surat-keluar' }, 'surat_keluar'],
        [{ folder: 'regulatory-sources', ruleSetId }, 'regulatory_source'],
        [{ folder: `arsip-attachments/${ruleSetId}` }, 'arsip'],
    ])('binds confirmation to the upload purpose: %j', async (options, purpose) => {
        await uploadFileToBlob(file, options);
        expect(blobSdk.getStatus).toHaveBeenCalledWith('/api/client-upload/status', { blobUrl: locator, purpose }, expect.any(Object));
        expect(blobSdk.upload).toHaveBeenCalledOnce();
    });
});
