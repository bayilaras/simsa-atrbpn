import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/cloud-platform.js', () => ({
    buildCloudPlatformConfig: () => ({
        firebaseSessionCookieName: '__session',
    }),
}));

vi.mock('../config/firebase-admin.js', () => ({
    getFirebaseAdminAuth: () => ({
        revokeRefreshTokens: vi.fn(),
    }),
}));

vi.mock('../config/trusted-origins.js', () => ({
    isTrustedOrigin: (origin: string) => origin === 'https://trusted.example',
}));

vi.mock('../middlewares/firebase-app-check.middleware.js', () => ({
    firebaseAppCheckMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
    firebaseReplayProtectedAppCheckMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../services/firebase-session.service.js', () => ({
    createFirebaseSession: vi.fn(),
    verifyFirebaseSessionCsrfToken: vi.fn(),
}));

vi.mock('../services/identity-user.service.js', () => ({
    archiveAccessProvisioningIssue: vi.fn(),
    findProvisionedIdentityUser: vi.fn(),
}));

vi.mock('../services/request-identity.service.js', () => ({
    hasBearerCredential: vi.fn(),
    verifyRequestIdentity: vi.fn(),
}));

const { default: firebaseAuthRouter } = await import('../routes/firebase-auth.routes.js');

function createApp() {
    const app = express();
    app.use(firebaseAuthRouter);
    return app;
}

describe('Firebase auth browser-origin boundary', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it.each([
        ['Cloud Run', { NODE_ENV: 'development', K_SERVICE: 'simsa-api' }],
        ['Vercel', { NODE_ENV: 'development', VERCEL: '1' }],
    ])('rejects a missing Origin in a deployed %s runtime', async (_name, environment) => {
        for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);

        const response = await request(createApp()).post('/sign-out');

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ error: 'Invalid origin' });
        expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('permits an Origin-less request only in a local development runtime', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('K_SERVICE', '');
        vi.stubEnv('VERCEL', '');

        await request(createApp()).post('/sign-out').expect(204);
    });

    it('accepts an explicitly trusted Origin in a deployed runtime', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('K_SERVICE', 'simsa-api');

        await request(createApp())
            .post('/sign-out')
            .set('Origin', 'https://trusted.example')
            .expect(204);
    });
});
