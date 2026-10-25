import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authConfig = vi.hoisted(() => ({ firebase: false }));
vi.mock('../lib/cloud-provider-config', () => ({
    get USE_FIREBASE_AUTH() { return authConfig.firebase; },
}));
vi.mock('../lib/firebase-client', () => ({
    getFirebaseAppCheckToken: vi.fn().mockResolvedValue('app-check-token'),
    getFirebaseLimitedUseAppCheckToken: vi.fn().mockResolvedValue('limited-use-app-check-token'),
}));

import api, { ApiClient, DEFAULT_API_TIMEOUT_MS } from './api';
import { getFirebaseAppCheckToken, getFirebaseLimitedUseAppCheckToken } from '../lib/firebase-client';
import {
    clearFirebaseSessionCsrfToken,
    setFirebaseSessionCsrfToken,
} from '../lib/firebase-session-security';

const COOKIE_TOKEN = 'a1'.repeat(32);
const FIREBASE_TOKEN = 'aB_-'.repeat(11);
const success = () => ({ ok: true, status: 200, json: async () => ({ success: true }) });

describe('ApiClient CSRF token boundaries', () => {
    beforeEach(() => {
        authConfig.firebase = false;
        document.cookie = 'csrf-token=; Max-Age=0; path=/';
        clearFirebaseSessionCsrfToken();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        document.cookie = 'csrf-token=; Max-Age=0; path=/';
        clearFirebaseSessionCsrfToken();
    });

    it.each([
        ['malformed percent escape', '%'],
        ['malformed UTF-8 escape', '%E0%A4%A'],
        ['short token', 'a'.repeat(63)],
        ['long token', 'a'.repeat(65)],
        ['non-hex token', 'g'.repeat(64)],
        ['uppercase token', 'A'.repeat(64)],
        ['encoded newline', `%0A${'a'.repeat(64)}`],
    ])('refreshes a cookie with a %s before sending a mutation', async (_label, cookie) => {
        document.cookie = `csrf-token=${cookie}; path=/`;
        const fetchMock = vi.fn()
            .mockImplementationOnce(async () => {
                document.cookie = `csrf-token=${COOKIE_TOKEN}; path=/`;
                return success();
            })
            .mockResolvedValueOnce(success());
        vi.stubGlobal('fetch', fetchMock);

        await expect(api.post('/api/example', { value: 1 })).resolves.toEqual({ success: true });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/health$/);
        expect(fetchMock.mock.calls[0][1]).toEqual({ method: 'GET', credentials: 'include', signal: expect.any(AbortSignal) });
        expect(fetchMock.mock.calls[1][1].headers['X-CSRF-Token']).toBe(COOKIE_TOKEN);
    });

    it('uses a valid decoded cookie without fetching health', async () => {
        document.cookie = `csrf-token=${'%61%31'.repeat(32)}; path=/`;
        const fetchMock = vi.fn().mockResolvedValue(success());
        vi.stubGlobal('fetch', fetchMock);

        await api.post('/api/example', {});

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0][1].headers['X-CSRF-Token']).toBe(COOKIE_TOKEN);
    });

    it('omits a malformed cookie on a read without attempting CSRF bootstrap', async () => {
        document.cookie = 'csrf-token=%; path=/';
        const fetchMock = vi.fn().mockResolvedValue(success());
        vi.stubGlobal('fetch', fetchMock);

        await expect(api.get('/api/example')).resolves.toEqual({ success: true });

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/example$/);
        expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-CSRF-Token');
    });

    it('never sends an invalid cookie when bootstrap fails', async () => {
        document.cookie = 'csrf-token=invalid-token; path=/';
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError('Network unavailable'))
            .mockResolvedValueOnce({
                ok: false, status: 403, headers: new Headers(),
                json: async () => ({ error: 'ForbiddenError', message: 'Token CSRF tidak valid.' }),
            });
        vi.stubGlobal('fetch', fetchMock);

        await expect(api.post('/api/example', {}))
            .rejects.toMatchObject({ status: 403, message: 'Token CSRF tidak valid.' });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty('X-CSRF-Token');
    });

    it('shares bootstrap across concurrent mutations waiting for a valid cookie', async () => {
        document.cookie = 'csrf-token=%; path=/';
        let completeBootstrap;
        const bootstrap = new Promise(resolve => { completeBootstrap = resolve; });
        const fetchMock = vi.fn().mockReturnValueOnce(bootstrap).mockResolvedValue(success());
        vi.stubGlobal('fetch', fetchMock);

        const first = api.post('/api/first', {});
        const second = api.post('/api/second', {});
        document.cookie = `csrf-token=${COOKIE_TOKEN}; path=/`;
        completeBootstrap(success());
        await Promise.all([first, second]);

        expect(fetchMock).toHaveBeenCalledTimes(3);
        for (const [, config] of fetchMock.mock.calls.slice(1)) {
            expect(config.headers['X-CSRF-Token']).toBe(COOKIE_TOKEN);
        }
    });

    it('preserves a Firebase session token and App Check despite a malformed legacy cookie', async () => {
        authConfig.firebase = true;
        document.cookie = 'csrf-token=%; path=/';
        setFirebaseSessionCsrfToken(FIREBASE_TOKEN);
        const fetchMock = vi.fn().mockResolvedValue(success());
        vi.stubGlobal('fetch', fetchMock);

        await api.post('/api/object-uploads', {});

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
            'X-CSRF-Token': FIREBASE_TOKEN,
            'X-Firebase-AppCheck': 'limited-use-app-check-token',
        });
    });

    it('bootstraps Firebase through get-session while retaining its non-hex token format', async () => {
        authConfig.firebase = true;
        document.cookie = 'csrf-token=%; path=/';
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: FIREBASE_TOKEN }) })
            .mockResolvedValueOnce(success());
        vi.stubGlobal('fetch', fetchMock);

        await api.post('/api/example', {});

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/auth\/get-session$/);
        expect(fetchMock.mock.calls[0][1].headers['X-Firebase-AppCheck']).toBe('app-check-token');
        expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
            'X-CSRF-Token': FIREBASE_TOKEN,
            'X-Firebase-AppCheck': 'app-check-token',
        });
    });
});

describe('ApiClient Firebase operation deadlines', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        authConfig.firebase = true;
        clearFirebaseSessionCsrfToken();
        vi.mocked(getFirebaseAppCheckToken).mockResolvedValue('app-check-token');
        vi.mocked(getFirebaseLimitedUseAppCheckToken).mockResolvedValue('limited-use-app-check-token');
    });
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        authConfig.firebase = false;
        clearFirebaseSessionCsrfToken();
        vi.mocked(getFirebaseAppCheckToken).mockResolvedValue('app-check-token');
        vi.mocked(getFirebaseLimitedUseAppCheckToken).mockResolvedValue('limited-use-app-check-token');
    });

    it.each([
        ['/api/example', getFirebaseAppCheckToken],
        ['/api/object-uploads', getFirebaseLimitedUseAppCheckToken],
    ])('bounds the App Check provider before dispatching %s', async (endpoint, provider) => {
        setFirebaseSessionCsrfToken(FIREBASE_TOKEN);
        vi.mocked(provider).mockReturnValueOnce(new Promise(() => {}));
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const client = new ApiClient('https://example.test');
        const rejection = expect(client.post(endpoint, {}, { timeoutMs: 500 }))
            .rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', mutationOutcomeUnknown: false });
        await vi.advanceTimersByTimeAsync(500);
        await rejection;
        expect(fetchMock).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('bounds Firebase session bootstrap response parsing and releases its shared promise', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
        vi.stubGlobal('fetch', fetchMock);
        const client = new ApiClient('https://example.test');
        const rejection = expect(client.post('/api/example', {}))
            .rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', mutationOutcomeUnknown: false });
        await vi.advanceTimersByTimeAsync(DEFAULT_API_TIMEOUT_MS);
        await rejection;
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/auth\/get-session$/);
        expect(client._csrfFetchPromise).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });
});
