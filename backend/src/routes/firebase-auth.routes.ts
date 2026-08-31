import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { buildCloudPlatformConfig } from '../config/cloud-platform.js';
import { getFirebaseAdminAuth } from '../config/firebase-admin.js';
import { isTrustedOrigin } from '../config/trusted-origins.js';
import {
    firebaseAppCheckMiddleware,
    firebaseReplayProtectedAppCheckMiddleware,
} from '../middlewares/firebase-app-check.middleware.js';
import {
    createFirebaseSession,
    verifyFirebaseSessionCsrfToken,
} from '../services/firebase-session.service.js';
import {
    archiveAccessProvisioningIssue,
    findProvisionedIdentityUser,
} from '../services/identity-user.service.js';
import {
    hasBearerCredential,
    verifyRequestIdentity,
    type VerifiedRequestIdentity,
} from '../services/request-identity.service.js';

const router = Router();

const sessionBody = z.object({
    idToken: z.string().min(100).max(16_384),
});

function requireTrustedBrowserOrigin(req: Request, res: Response, next: NextFunction): void {
    const origin = req.headers.origin;
    if (origin && isTrustedOrigin(origin)) {
        next();
        return;
    }
    const deployedRuntime = process.env.NODE_ENV === 'production'
        || Boolean(process.env.K_SERVICE)
        || Boolean(process.env.VERCEL);
    if (!origin && !deployedRuntime) {
        next();
        return;
    }
    res.status(403).json({ error: 'Invalid origin' });
}

function publicUser(user: Awaited<ReturnType<typeof findProvisionedIdentityUser>>) {
    if (!user) return null;
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        unitKerjaId: user.unitKerjaId,
    };
}

async function requireProvisionedFirebaseIdentity(identity: VerifiedRequestIdentity) {
    if (identity.provider !== 'firebase' || identity.emailVerified !== true) return null;
    const user = await findProvisionedIdentityUser(identity);
    if (!user || !user.isActive || archiveAccessProvisioningIssue(user) !== null) return null;
    return user;
}

function firebaseSessionCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production'
            || Boolean(process.env.K_SERVICE)
            || Boolean(process.env.VERCEL),
        sameSite: 'lax' as const,
        path: '/',
    };
}

function clearFirebaseSessionCookie(res: Response): void {
    const config = buildCloudPlatformConfig();
    res.clearCookie(config.firebaseSessionCookieName, firebaseSessionCookieOptions());
}

// This router is mounted before the application's general body parser because
// Better Auth historically required the same ordering.
router.use(express.json({ limit: '32kb', type: 'application/json' }));
router.use(firebaseAppCheckMiddleware);
router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

router.post('/session', firebaseReplayProtectedAppCheckMiddleware, requireTrustedBrowserOrigin, async (req, res) => {
    const parsed = sessionBody.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: 'Firebase ID token is required' });
        return;
    }
    try {
        const created = await createFirebaseSession(parsed.data.idToken);
        const user = await requireProvisionedFirebaseIdentity({
            provider: 'firebase',
            subject: created.decoded.uid,
            email: created.decoded.email,
            emailVerified: created.decoded.email_verified,
            name: typeof created.decoded.name === 'string' ? created.decoded.name : undefined,
            tokenKind: 'firebase-id-token',
        });
        if (!user) {
            clearFirebaseSessionCookie(res);
            res.status(403).json({
                error: 'Identity is not fully provisioned, active, and email-verified in SIMSA',
            });
            return;
        }
        const config = buildCloudPlatformConfig();
        res.cookie(config.firebaseSessionCookieName, created.sessionCookie, {
            ...firebaseSessionCookieOptions(),
            maxAge: created.expiresInMs,
        });
        res.status(200).json({
            user: publicUser(user),
            csrfToken: created.csrfToken,
            expiresAt: new Date(Date.now() + created.expiresInMs).toISOString(),
        });
    } catch (error) {
        // A failed account switch must not leave a previous user's ambient
        // cookie active on a shared workstation.
        clearFirebaseSessionCookie(res);
        const recent = error instanceof Error && error.message === 'RECENT_SIGN_IN_REQUIRED';
        res.status(recent ? 401 : 403).json({
            error: recent ? 'Recent Firebase sign-in required' : 'Invalid Firebase identity',
        });
    }
});

router.get('/get-session', async (req, res) => {
    try {
        const identity = await verifyRequestIdentity(req);
        if (!identity) {
            res.status(200).json(null);
            return;
        }
        const user = await requireProvisionedFirebaseIdentity(identity);
        if (!user) {
            res.status(200).json(null);
            return;
        }
        const config = buildCloudPlatformConfig();
        const sessionCookie = req.cookies?.[config.firebaseSessionCookieName];
        res.status(200).json({
            user: publicUser(user),
            session: { userId: user.id },
            csrfToken: typeof sessionCookie === 'string'
                ? (await import('../services/firebase-session.service.js'))
                    .createFirebaseSessionCsrfToken(sessionCookie)
                : undefined,
        });
    } catch {
        res.status(200).json(null);
    }
});

router.post('/sign-out', requireTrustedBrowserOrigin, async (req, res) => {
    clearFirebaseSessionCookie(res);
    res.status(204).end();
});

router.post('/revoke-sessions', firebaseReplayProtectedAppCheckMiddleware, requireTrustedBrowserOrigin, async (req, res) => {
    try {
        const config = buildCloudPlatformConfig();
        const sessionCookie = req.cookies?.[config.firebaseSessionCookieName];
        if (!hasBearerCredential(req) && (
            typeof sessionCookie !== 'string'
            || !verifyFirebaseSessionCsrfToken(
                sessionCookie,
                req.headers['x-csrf-token'] as string | undefined,
            )
        )) {
            res.status(403).json({ error: 'CSRF validation failed' });
            return;
        }
        const identity = await verifyRequestIdentity(req);
        const user = identity ? await requireProvisionedFirebaseIdentity(identity) : null;
        if (!identity || !user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        await getFirebaseAdminAuth().revokeRefreshTokens(identity.subject);
        clearFirebaseSessionCookie(res);
        res.status(204).end();
    } catch {
        res.status(401).json({ error: 'Unauthorized' });
    }
});

export default router;
