import type { Request } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { buildCloudPlatformConfig } from '../config/cloud-platform.js';
import { getFirebaseAdminAuth } from '../config/firebase-admin.js';

export interface VerifiedRequestIdentity {
    provider: 'better-auth' | 'firebase';
    subject: string;
    email?: string;
    emailVerified?: boolean;
    name?: string;
    tokenKind: 'better-auth-session' | 'firebase-id-token' | 'firebase-session-cookie';
}

function bearerToken(req: Request): string | null {
    const authorization = req.headers.authorization;
    if (!authorization) return null;
    const match = authorization.match(/^Bearer ([^\s]+)$/i);
    return match?.[1] || null;
}

function fromFirebaseToken(
    token: DecodedIdToken,
    tokenKind: VerifiedRequestIdentity['tokenKind'],
): VerifiedRequestIdentity {
    return {
        provider: 'firebase',
        subject: token.uid,
        email: token.email,
        emailVerified: token.email_verified,
        name: typeof token.name === 'string' ? token.name : undefined,
        tokenKind,
    };
}

export async function verifyRequestIdentity(
    req: Request,
): Promise<VerifiedRequestIdentity | null> {
    const config = buildCloudPlatformConfig();
    if (config.authProvider === 'better-auth') {
        const { auth } = await import('../config/auth.js');
        const session = await auth.api.getSession({ headers: req.headers as any });
        if (!session) return null;
        return {
            provider: 'better-auth',
            subject: session.user.id,
            email: session.user.email,
            name: session.user.name,
            tokenKind: 'better-auth-session',
        };
    }

    const firebaseAuth = getFirebaseAdminAuth();
    const bearer = bearerToken(req);
    if (bearer) {
        const token = await firebaseAuth.verifyIdToken(bearer, config.firebaseCheckRevoked);
        return fromFirebaseToken(token, 'firebase-id-token');
    }
    const sessionCookie = req.cookies?.[config.firebaseSessionCookieName];
    if (!sessionCookie || typeof sessionCookie !== 'string') return null;
    const token = await firebaseAuth.verifySessionCookie(
        sessionCookie,
        config.firebaseCheckRevoked,
    );
    return fromFirebaseToken(token, 'firebase-session-cookie');
}

export function hasBearerCredential(req: Request): boolean {
    return bearerToken(req) !== null;
}
