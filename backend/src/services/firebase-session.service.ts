import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { buildCloudPlatformConfig } from '../config/cloud-platform.js';
import { getFirebaseAdminAuth } from '../config/firebase-admin.js';

const RECENT_SIGN_IN_SECONDS = 5 * 60;

function csrfSecret(): string {
    const secret = buildCloudPlatformConfig().firebaseSessionCsrfSecret;
    if (secret.length < 32) {
        throw new Error('FIREBASE_SESSION_CSRF_SECRET must be at least 32 characters');
    }
    return secret;
}

export function createFirebaseSessionCsrfToken(sessionCookie: string): string {
    return createHmac('sha256', csrfSecret()).update(sessionCookie).digest('base64url');
}

export function verifyFirebaseSessionCsrfToken(
    sessionCookie: string,
    supplied: string | undefined,
): boolean {
    if (!supplied) return false;
    const expected = createFirebaseSessionCsrfToken(sessionCookie);
    const expectedBytes = Buffer.from(expected);
    const suppliedBytes = Buffer.from(supplied);
    if (expectedBytes.length !== suppliedBytes.length) return false;
    return timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function createFirebaseSession(idToken: string): Promise<{
    sessionCookie: string;
    csrfToken: string;
    decoded: DecodedIdToken;
    expiresInMs: number;
}> {
    const config = buildCloudPlatformConfig();
    const firebaseAuth = getFirebaseAdminAuth();
    const decoded = await firebaseAuth.verifyIdToken(idToken, true);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!decoded.auth_time || nowSeconds - decoded.auth_time > RECENT_SIGN_IN_SECONDS) {
        throw new Error('RECENT_SIGN_IN_REQUIRED');
    }
    const sessionCookie = await firebaseAuth.createSessionCookie(idToken, {
        expiresIn: config.firebaseSessionMaxAgeMs,
    });
    return {
        sessionCookie,
        csrfToken: createFirebaseSessionCsrfToken(sessionCookie),
        decoded,
        expiresInMs: config.firebaseSessionMaxAgeMs,
    };
}
