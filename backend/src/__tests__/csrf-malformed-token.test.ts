import { afterEach, describe, expect, it, vi } from 'vitest';
import { csrfCookieSetter, csrfProtection } from '../middlewares/csrf.middleware.js';

afterEach(() => vi.unstubAllEnvs());
const token = 'a'.repeat(64);
function check(cookie: unknown, header: unknown) {
    vi.stubEnv('AUTH_PROVIDER', 'better-auth');
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    csrfProtection({ method: 'POST', path: '/arsip', cookies: { 'csrf-token': cookie },
        headers: { 'x-csrf-token': header } } as any, response as any, next);
    return { response, next };
}

describe('malformed CSRF credentials', () => {
    it.each(['é'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), [token], { length: 64 }, null])(
        'rejects malformed headers normally, without throwing or advancing', header => {
            const { response, next } = check(token, header);
            expect(response.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
        },
    );
    it.each(['é'.repeat(64), [token], { length: 64 }, 'g'.repeat(64)])(
        'rejects malformed cookies normally', cookie => {
            const { response, next } = check(cookie, token);
            expect(response.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
        },
    );
    it('accepts matching generated tokens and rejects a different valid token', () => {
        expect(check(token, token).next).toHaveBeenCalledOnce();
        expect(check(token, 'b'.repeat(64)).response.status).toHaveBeenCalledWith(403);
    });
    it('replaces a malformed cookie so refreshing restores a usable token', () => {
        vi.stubEnv('AUTH_PROVIDER', 'better-auth');
        const response = { cookie: vi.fn() };
        csrfCookieSetter({ cookies: { 'csrf-token': 'malformed' } } as any, response as any, vi.fn());
        expect(response.cookie).toHaveBeenCalledWith('csrf-token', expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(Object));
    });
    it.each([
        { NODE_ENV: 'development', VERCEL: '1', K_SERVICE: '', secure: true },
        { NODE_ENV: 'test', VERCEL: '', K_SERVICE: 'api', secure: true },
        { NODE_ENV: 'development', VERCEL: '', K_SERVICE: '', secure: false },
    ])('keeps deployed cookies secure while allowing local HTTP development: %j', source => {
        vi.stubEnv('AUTH_PROVIDER', 'better-auth');
        for (const name of ['NODE_ENV', 'VERCEL', 'K_SERVICE'] as const) vi.stubEnv(name, source[name]);
        const response = { cookie: vi.fn() };
        csrfCookieSetter({ cookies: {} } as any, response as any, vi.fn());
        expect(response.cookie).toHaveBeenCalledWith('csrf-token', expect.any(String), expect.objectContaining({
            secure: source.secure, partitioned: source.secure, sameSite: source.secure ? 'none' : 'strict',
        }));
    });
});
