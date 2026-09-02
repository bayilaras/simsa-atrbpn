import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyToken = vi.hoisted(() => vi.fn());
const appCheckConfig = vi.hoisted(() => ({
    authProvider: 'firebase',
    firebaseAppCheckRequired: true,
    firebaseAppCheckAppIds: ['1:123456789012:web:abcdef123456'],
}));

vi.mock('../config/cloud-platform.js', () => ({
    buildCloudPlatformConfig: () => appCheckConfig,
}));

vi.mock('../config/firebase-admin.js', () => ({
    getFirebaseAdminAppCheck: () => ({ verifyToken }),
}));

const {
    firebaseAppCheckMiddleware,
    firebaseReplayProtectedAppCheckMiddleware,
} = await import('../middlewares/firebase-app-check.middleware.js');

function requestWithToken(token = 'app-check-token') {
    return {
        path: '/sensitive',
        header: vi.fn((name: string) => name === 'X-Firebase-AppCheck' ? token : undefined),
    } as unknown as Request;
}

function response() {
    return {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
    } as unknown as Response;
}

describe('Firebase App Check middleware', () => {
    beforeEach(() => verifyToken.mockReset());

    it('accepts only an allowlisted Firebase Web App ID', async () => {
        verifyToken.mockResolvedValue({
            appId: '1:123456789012:web:abcdef123456',
            token: {},
        });
        const res = response();
        const next = vi.fn() as NextFunction;

        await firebaseAppCheckMiddleware(requestWithToken(), res, next);

        expect(verifyToken).toHaveBeenCalledWith('app-check-token', { consume: false });
        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('rejects a valid project token issued to another Firebase app', async () => {
        verifyToken.mockResolvedValue({
            appId: '1:123456789012:web:ffffffffffff',
            token: {},
        });
        const res = response();
        const next = vi.fn() as NextFunction;

        await firebaseAppCheckMiddleware(requestWithToken(), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('consumes a limited-use token and rejects a replay', async () => {
        verifyToken.mockResolvedValue({
            appId: '1:123456789012:web:abcdef123456',
            token: {},
            alreadyConsumed: true,
        });
        const res = response();
        const next = vi.fn() as NextFunction;

        await firebaseReplayProtectedAppCheckMiddleware(requestWithToken(), res, next);

        expect(verifyToken).toHaveBeenCalledWith('app-check-token', { consume: true });
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Firebase App Check token was already consumed',
        });
    });
});
