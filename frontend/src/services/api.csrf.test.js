import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';

const COOKIE_TOKEN = 'a1'.repeat(32);
const success = () => ({ ok: true, status: 200, json: async () => ({ success: true }) });

describe('ApiClient CSRF token boundaries', () => {
    beforeEach(() => {
        document.cookie = 'csrf-token=; Max-Age=0; path=/';
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        document.cookie = 'csrf-token=; Max-Age=0; path=/';
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
        expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/capabilities$/);
        expect(fetchMock.mock.calls[0][1]).toEqual({ method: 'GET', credentials: 'include', signal: expect.any(AbortSignal) });
        expect(fetchMock.mock.calls[1][1].headers['X-CSRF-Token']).toBe(COOKIE_TOKEN);
    });

    it('uses a valid decoded cookie without a bootstrap request', async () => {
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
});
