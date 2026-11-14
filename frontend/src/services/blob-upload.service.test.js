import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    PESAN_NAMA_BERKAS_TIDAK_DIDUKUNG,
    PESAN_UNGGAH_DITOLAK,
    businessUploadTimeoutMs,
    uploadFileToBlob,
    waitForVercelBlobReady,
} from './blob-upload.service';

const blobSdk = vi.hoisted(() => ({ upload: vi.fn(), getStatus: vi.fn() }));
vi.mock('@vercel/blob/client', () => blobSdk);
vi.mock('./api', () => ({ api: { get: blobSdk.getStatus } }));
vi.mock('../lib/cloud-provider-config', () => ({ STORAGE_PROVIDER: 'vercel-blob' }));
const ruleSetId = '08002020-0800-4080-8080-000000000008';

beforeEach(() => {
    blobSdk.getStatus.mockReset();
    blobSdk.getStatus.mockResolvedValue({ status: 'ready', expiresAt: '2040-01-01T00:00:00.000Z' });
});

describe('direct upload validation', () => {
    beforeEach(() => {
        blobSdk.upload.mockReset();
    });

    it.each([
        { name: 'arsip.pdf', type: 'application/pdf', size: 10_485_761 },
        { name: 'arsip.exe', type: 'application/pdf', size: 10 },
        { name: 'arsip.pdf', type: 'image/png', size: 10 },
        { name: 'arsip.pdf', type: 'application/pdf', size: 0 },
    ])('does not request storage authorization for an invalid PDF: %j', async file => {
        await expect(uploadFileToBlob(file, { folder: 'surat-masuk' })).rejects.toThrow();
        expect(blobSdk.upload).not.toHaveBeenCalled();
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

    it('reports a network failure with recovery instructions and storage rejections in Indonesian', async () => {
        blobSdk.upload.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await expect(uploadFileToBlob(file, { folder: 'surat-masuk' }))
            .rejects.toMatchObject({ code: 'UPLOAD_CONNECTION_FAILED', message: expect.stringContaining('muat ulang halaman') });
        const denied = new Error('Vercel Blob: Failed to retrieve the client token');
        blobSdk.upload.mockRejectedValueOnce(denied);
        await expect(uploadFileToBlob(file, { folder: 'surat-masuk' }))
            .rejects.toMatchObject({ code: 'UPLOAD_REJECTED', message: PESAN_UNGGAH_DITOLAK, cause: denied });
        const lain = new Error('kesalahan lain');
        blobSdk.upload.mockRejectedValueOnce(lain);
        await expect(uploadFileToBlob(file, { folder: 'surat-masuk' })).rejects.toBe(lain);
    });

    it.each(['Surat No.12..pdf', 'map\\surat.pdf'])('rejects the file name %s before requesting storage authorization', async name => {
        blobSdk.upload.mockReset();
        const berkas = new File(['pdf'], name, { type: 'application/pdf' });
        await expect(uploadFileToBlob(berkas, { folder: 'surat-masuk' })).rejects.toThrow(PESAN_NAMA_BERKAS_TIDAK_DIDUKUNG);
        expect(blobSdk.upload).not.toHaveBeenCalled();
    });
});

describe('upload deadline that follows the PDF size', () => {
    const MiB = 1024 * 1024;

    beforeEach(() => {
        blobSdk.upload.mockReset();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('keeps two minutes for small files, grows with the size, and stops at ten minutes', () => {
        expect(businessUploadTimeoutMs(3)).toBe(120_000);
        expect(businessUploadTimeoutMs(MiB)).toBe(120_000);
        expect(businessUploadTimeoutMs(5 * MiB)).toBe(220_000);
        expect(businessUploadTimeoutMs(10 * MiB)).toBe(380_000);
        expect(businessUploadTimeoutMs(100 * MiB)).toBe(600_000);
        expect(businessUploadTimeoutMs(undefined)).toBe(120_000);
    });

    it('lets a 10 MiB letter PDF upload past two minutes and then suggests making the PDF smaller', async () => {
        vi.useFakeTimers();
        blobSdk.upload.mockReturnValue(new Promise(() => {}));
        let settled = false;
        const pending = uploadFileToBlob({ name: 'surat.pdf', type: 'application/pdf', size: 10 * MiB }, { folder: 'surat-masuk' })
            .finally(() => { settled = true; });
        const rejection = expect(pending).rejects.toMatchObject({
            code: 'UPLOAD_TIMEOUT',
            message: expect.stringContaining('kecilkan ukurannya terlebih dahulu (misalnya dengan fitur kompres PDF)'),
        });
        await vi.dynamicImportSettled();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(259_999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await rejection;
        expect(blobSdk.upload.mock.calls[0][2].abortSignal.aborted).toBe(true);
    });

    it('does not tell regulation uploads (up to 50 MiB) to compress their source PDF', async () => {
        vi.useFakeTimers();
        blobSdk.upload.mockReturnValue(new Promise(() => {}));
        const pending = uploadFileToBlob(new File(['pdf'], 'peraturan.pdf', { type: 'application/pdf' }), { folder: 'regulatory-sources', ruleSetId });
        const rejection = expect(pending).rejects.toMatchObject({ code: 'UPLOAD_TIMEOUT' });
        await vi.dynamicImportSettled();
        await vi.advanceTimersByTimeAsync(600_000);
        await rejection;
        await pending.catch(error => expect(error.message).not.toContain('kompres'));
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
