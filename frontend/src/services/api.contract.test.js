import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api, { ApiClient, DEFAULT_API_TIMEOUT_MS, FILE_API_TIMEOUT_MS } from './api';

describe('ApiClient transport contracts', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        document.cookie = 'csrf-token=; Max-Age=0; path=/';
    });

    it('returns a Blob without trying to parse a PDF as JSON', async () => {
        const pdf = new Blob(['pdf-bytes'], { type: 'application/pdf' });
        const json = vi.fn();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            blob: vi.fn().mockResolvedValue(pdf),
            json,
        }));

        const result = await api.get('/api/example.pdf', {}, { responseType: 'blob' });

        expect(result).toBe(pdf);
        expect(json).not.toHaveBeenCalled();
    });

    it('exposes successful raw responses without consuming their private document stream', async () => {
        const response = { ok: true, status: 200, headers: new Headers(), json: vi.fn(), blob: vi.fn() };
        const fetchMock = vi.fn().mockResolvedValue(response);
        vi.stubGlobal('fetch', fetchMock);

        const result = await api.get('/api/files/surat_masuk/id', {}, { responseType: 'response' });
        expect(result.headers).toBe(response.headers);
        expect(result.status).toBe(response.status);
        expect(response.json).not.toHaveBeenCalled();
        expect(response.blob).not.toHaveBeenCalled();
        expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('responseType');
        await result.blob();
    });

    it('still rejects private-file errors when a raw response is requested', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false, status: 403, headers: new Headers(),
            json: async () => ({ error: 'Akses ditolak' }),
        }));
        await expect(api.get('/api/files/surat_masuk/id', {}, { responseType: 'response' }))
            .rejects.toMatchObject({ status: 403, message: 'Akses ditolak' });
    });

    it('does not turn an aborted document request into a retry or a connection error', async () => {
        const aborted = new DOMException('Viewer closed', 'AbortError');
        const fetchMock = vi.fn().mockRejectedValue(aborted);
        vi.stubGlobal('fetch', fetchMock);

        await expect(api.get('/api/files/surat_masuk/id', {}, { signal: new AbortController().signal }))
            .rejects.toBe(aborted);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('never sends an already cancelled request', async () => {
        const controller = new AbortController();
        controller.abort();
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(api.get('/api/files/surat_masuk/id', {}, { signal: controller.signal }))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends FormData unchanged and lets fetch set the multipart boundary', async () => {
        const csrfToken = 'a'.repeat(64);
        document.cookie = `csrf-token=${csrfToken}; path=/`;
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({ success: true }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const body = new FormData();
        body.append('files', new File(['content'], 'arsip.pdf', { type: 'application/pdf' }));

        await api.post('/api/bulk-upload', body);

        const [, config] = fetchMock.mock.calls[0];
        expect(config.body).toBe(body);
        expect(config.headers).not.toHaveProperty('Content-Type');
        expect(config.headers['X-CSRF-Token']).toBe(csrfToken);
    });

    it('keeps backend error data available to Error and legacy Axios consumers', async () => {
        const errorBody = {
            error: 'Unggah ditolak',
            details: [{ field: 'files', message: 'PDF wajib diisi' }],
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            headers: new Headers(),
            json: vi.fn().mockResolvedValue(errorBody),
        }));

        await expect(api.get('/api/failure')).rejects.toMatchObject({
            message: 'Unggah ditolak',
            status: 400,
            details: errorBody.details,
            data: errorBody,
            response: { status: 400, data: errorBody },
        });
    });
});

describe('ApiClient bounded operation lifetime', () => {
    let client;
    const success = () => ({ ok: true, status: 200, json: async () => ({ success: true }) });
    const pending = () => new Promise(() => {});
    beforeEach(() => {
        vi.useFakeTimers();
        client = new ApiClient('https://example.test');
        document.cookie = `csrf-token=${'a'.repeat(64)}; path=/`;
    });
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        document.cookie = 'csrf-token=; Max-Age=0; path=/';
    });

    it.each(['post', 'put', 'patch', 'delete'])('bounds a stalled %s without replay and describes its uncertain result', async method => {
        const fetchMock = vi.fn(pending);
        vi.stubGlobal('fetch', fetchMock);
        const result = client[method]('/api/record', { title: 'record' }, { timeoutMs: 250 });
        const rejection = expect(result).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', mutationOutcomeUnknown: true,
            message: expect.stringContaining('Periksa data terbaru') });
        await vi.advanceTimersByTimeAsync(250);
        await rejection;
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
        expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('timeoutMs');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps the default CRUD deadline across response header and JSON parsing stages', async () => {
        let headers;
        vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { headers = resolve; })));
        const result = client.post('/api/record', {});
        const rejection = expect(result).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', timeoutMs: DEFAULT_API_TIMEOUT_MS });
        await vi.advanceTimersByTimeAsync(DEFAULT_API_TIMEOUT_MS - 500);
        headers({ ok: true, status: 200, json: pending });
        await vi.advanceTimersByTimeAsync(500);
        await rejection;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('bounds a stalled HTTP error body instead of waiting forever for its message', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: pending });
        vi.stubGlobal('fetch', fetchMock);
        const result = client.get('/api/record', {}, { timeoutMs: 200 });
        const rejection = expect(result).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', mutationOutcomeUnknown: false });
        await vi.advanceTimersByTimeAsync(200);
        await rejection;
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('bounds shared CSRF bootstrap and allows a fresh bootstrap after the hung one expires', async () => {
        document.cookie = 'csrf-token=; Max-Age=0; path=/';
        const fetchMock = vi.fn().mockImplementationOnce(pending).mockImplementation(async url => {
            if (url.endsWith('/api/health')) document.cookie = `csrf-token=${'a'.repeat(64)}; path=/`;
            return success();
        });
        vi.stubGlobal('fetch', fetchMock);
        const result = client.post('/api/record', {});
        const rejection = expect(result).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', mutationOutcomeUnknown: false });
        await vi.advanceTimersByTimeAsync(DEFAULT_API_TIMEOUT_MS);
        await rejection;
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/health$/);
        await expect(client.post('/api/record', {})).resolves.toEqual({ success: true });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('cancels one CSRF waiter without cancelling another or dispatching the cancelled mutation', async () => {
        document.cookie = 'csrf-token=; Max-Age=0; path=/';
        let resolveBootstrap;
        const fetchMock = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveBootstrap = resolve; })).mockResolvedValue(success());
        vi.stubGlobal('fetch', fetchMock);
        const controller = new AbortController();
        const first = client.post('/api/first', {}, { signal: controller.signal });
        const rejection = expect(first).rejects.toMatchObject({ name: 'AbortError' });
        const second = client.post('/api/second', {});
        controller.abort();
        await rejection;
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
        document.cookie = `csrf-token=${'a'.repeat(64)}; path=/`;
        resolveBootstrap(success());
        await expect(second).resolves.toEqual({ success: true });
        expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['https://example.test/api/health', 'https://example.test/api/second']);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('uses the remaining deadline for the one safe-method retry', async () => {
        const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockImplementationOnce(pending);
        vi.stubGlobal('fetch', fetchMock);
        const result = client.get('/api/record', {}, { timeoutMs: 1100 });
        const rejection = expect(result).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
        await vi.advanceTimersByTimeAsync(1100);
        await rejection;
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not retry after cancellation during retry backoff', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
        vi.stubGlobal('fetch', fetchMock);
        const controller = new AbortController();
        const result = client.get('/api/record', {}, { signal: controller.signal });
        const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
        await vi.advanceTimersByTimeAsync(100);
        controller.abort();
        await rejection;
        await vi.advanceTimersByTimeAsync(2000);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not retry a disconnected mutation and retains its uncertain-outcome error', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('connection reset'));
        vi.stubGlobal('fetch', fetchMock);
        await expect(client.post('/api/record', {})).rejects.toMatchObject({ code: 'NETWORK_ERROR', mutationOutcomeUnknown: true });
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['blob', 'arrayBuffer'])('allows the longer file deadline and bounds stalled %s processing', async responseType => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, [responseType]: pending }));
        const result = client.get('/api/file', {}, { responseType });
        const rejection = expect(result).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', timeoutMs: FILE_API_TIMEOUT_MS });
        await vi.advanceTimersByTimeAsync(FILE_API_TIMEOUT_MS);
        await rejection;
    });

    it('retains a deadline through lazy raw-response stream consumption without prebuffering', async () => {
        const read = vi.fn(pending), cancel = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({ read, cancel }) } }));
        const response = await client.get('/api/private-file', {}, { responseType: 'response', timeoutMs: 300 });
        expect(read).not.toHaveBeenCalled();
        const result = response.body.getReader().read();
        const rejection = expect(result).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
        await vi.advanceTimersByTimeAsync(300);
        await rejection;
        expect(cancel).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('retains a deadline when a raw-response consumer calls blob()', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, blob: pending }));
        const response = await client.get('/api/private-file', {}, { responseType: 'response', timeoutMs: 100 });
        const rejection = expect(response.blob()).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
        await vi.advanceTimersByTimeAsync(100);
        await rejection;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not let a second awaited reader cancellation hang after a timed-out read', async () => {
        const cancel = vi.fn(pending);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200,
            body: { getReader: () => ({ read: pending, cancel }) } }));
        const response = await client.get('/api/private-file', {}, { responseType: 'response', timeoutMs: 100 });
        const reader = response.body.getReader();
        const result = (async () => {
            try { await reader.read(); }
            catch (error) { await reader.cancel().catch(() => {}); throw error; }
        })();
        const rejection = expect(result).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
        await vi.advanceTimersByTimeAsync(100);
        await rejection;
        expect(cancel).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('bounds a direct raw stream cancellation without clearing its timer prematurely', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200,
            body: { getReader: () => ({}), cancel: pending } }));
        const response = await client.get('/api/private-file', {}, { responseType: 'response', timeoutMs: 100 });
        const rejection = expect(response.body.cancel()).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
        await vi.advanceTimersByTimeAsync(100);
        await rejection;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cleans its deadline and preserves structured HTTP errors on normal completion', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, headers: new Headers(), json: async () => ({ error: 'Invalid', details: [{ field: 'name' }] }) });
        vi.stubGlobal('fetch', fetchMock);
        await expect(client.post('/api/record', {})).rejects.toMatchObject({ status: 400, details: [{ field: 'name' }] });
        expect(vi.getTimerCount()).toBe(0);
    });
});
