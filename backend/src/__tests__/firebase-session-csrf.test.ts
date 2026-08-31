import { createHmac } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseAuth = vi.hoisted(() => ({
    verifyIdToken: vi.fn(),
    createSessionCookie: vi.fn(),
}));

vi.mock('../config/firebase-admin.js', () => ({
    getFirebaseAdminAuth: () => firebaseAuth,
}));

const {
    createFirebaseSession,
    createFirebaseSessionCsrfToken,
    verifyFirebaseSessionCsrfToken,
} = await import('../services/firebase-session.service.js');
const { csrfCookieSetter, csrfProtection } = await import('../middlewares/csrf.middleware.js');

const csrfSecret = 'firebase-session-csrf-secret-for-tests';

describe('Firebase session CSRF', () => {
    beforeEach(() => {
        vi.stubEnv('AUTH_PROVIDER', 'firebase');
        vi.stubEnv('FIREBASE_PROJECT_ID', 'simsa-test');
        vi.stubEnv('FIREBASE_SESSION_CSRF_SECRET', csrfSecret);
        vi.stubEnv('FIREBASE_SESSION_MAX_AGE_HOURS', '2');
        firebaseAuth.verifyIdToken.mockReset();
        firebaseAuth.createSessionCookie.mockReset();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('derives a deterministic, session-bound HMAC token', () => {
        const expected = createHmac('sha256', csrfSecret)
            .update('session-cookie-a')
            .digest('base64url');

        expect(createFirebaseSessionCsrfToken('session-cookie-a')).toBe(expected);
        expect(verifyFirebaseSessionCsrfToken('session-cookie-a', expected)).toBe(true);
        expect(verifyFirebaseSessionCsrfToken('session-cookie-b', expected)).toBe(false);
    });

    it('rejects missing, malformed, and Unicode tokens without throwing', () => {
        const valid = createFirebaseSessionCsrfToken('session-cookie');

        expect(verifyFirebaseSessionCsrfToken('session-cookie', undefined)).toBe(false);
        expect(verifyFirebaseSessionCsrfToken('session-cookie', 'x'.repeat(valid.length))).toBe(false);
        expect(() => verifyFirebaseSessionCsrfToken(
            'session-cookie',
            'é'.repeat(valid.length),
        )).not.toThrow();
        expect(verifyFirebaseSessionCsrfToken(
            'session-cookie',
            'é'.repeat(valid.length),
        )).toBe(false);
    });

    it('fails closed when the HMAC secret is too short', () => {
        vi.stubEnv('FIREBASE_SESSION_CSRF_SECRET', 'short');

        expect(() => createFirebaseSessionCsrfToken('session-cookie')).toThrow(
            /at least 32 characters/,
        );
    });

    it('creates a bounded session only from a recently authenticated ID token', async () => {
        const nowSeconds = 1_800_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(nowSeconds * 1000);
        const decoded = {
            uid: 'firebase-user-1',
            auth_time: nowSeconds - 60,
            email: 'user@example.test',
            email_verified: true,
        };
        firebaseAuth.verifyIdToken.mockResolvedValue(decoded);
        firebaseAuth.createSessionCookie.mockResolvedValue('firebase-session-cookie');

        const result = await createFirebaseSession('firebase-id-token');

        expect(firebaseAuth.verifyIdToken).toHaveBeenCalledWith('firebase-id-token', true);
        expect(firebaseAuth.createSessionCookie).toHaveBeenCalledWith('firebase-id-token', {
            expiresIn: 2 * 60 * 60 * 1000,
        });
        expect(result).toMatchObject({
            decoded,
            sessionCookie: 'firebase-session-cookie',
            expiresInMs: 2 * 60 * 60 * 1000,
        });
        expect(verifyFirebaseSessionCsrfToken(
            result.sessionCookie,
            result.csrfToken,
        )).toBe(true);
    });

    it('rejects a stale sign-in before minting a session cookie', async () => {
        const nowSeconds = 1_800_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(nowSeconds * 1000);
        firebaseAuth.verifyIdToken.mockResolvedValue({
            uid: 'firebase-user-1',
            auth_time: nowSeconds - 301,
        });

        await expect(createFirebaseSession('stale-id-token')).rejects.toThrow(
            'RECENT_SIGN_IN_REQUIRED',
        );
        expect(firebaseAuth.createSessionCookie).not.toHaveBeenCalled();
    });

    it('accepts a matching session-bound header in Firebase cookie mode', () => {
        const sessionCookie = 'firebase-session-cookie';
        const req = {
            method: 'POST',
            path: '/arsip',
            cookies: { __session: sessionCookie },
            headers: {
                'x-csrf-token': createFirebaseSessionCsrfToken(sessionCookie),
            },
        } as unknown as Request;
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
        } as unknown as Response;
        const next = vi.fn() as NextFunction;

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('rejects ambient Firebase cookies without their session-bound header', () => {
        const req = {
            method: 'DELETE',
            path: '/arsip/record-1',
            cookies: { __session: 'firebase-session-cookie' },
            headers: {},
        } as unknown as Request;
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
        } as unknown as Response;
        const next = vi.fn() as NextFunction;

        csrfProtection(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: 'CSRF Validation Failed',
        }));
    });

    it('allows explicit bearer authority without cookie CSRF', () => {
        const req = {
            method: 'PATCH',
            path: '/arsip/record-1',
            cookies: {},
            headers: { authorization: 'Bearer firebase-id-token' },
        } as unknown as Request;
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
        } as unknown as Response;
        const next = vi.fn() as NextFunction;

        csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('does not issue the legacy readable CSRF cookie in Firebase mode', () => {
        const req = { cookies: {} } as Request;
        const res = { cookie: vi.fn() } as unknown as Response;
        const next = vi.fn() as NextFunction;

        csrfCookieSetter(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(res.cookie).not.toHaveBeenCalled();
    });
});
