import { isIP } from 'node:net';
import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import type { AuthRequest } from './auth.middleware.js';
import { verifyRequestIdentity } from '../services/request-identity.service.js';
import { archiveAccessProvisioningIssue } from '../services/identity-user.service.js';
import { ServiceUnavailableError } from '../utils/errors.js';

// Better Auth session cookie, with or without the secure-cookie prefix. Its
// getSessionCookie helper expects Fetch headers, not a Node request.
export const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?better-auth[.-]session_token=/;

/** Client network quota key; IPv6 clients are grouped per /56 as before. */
export function networkRateLimitKey(req: Request): string {
    const address = req.ip;
    // Without a client address the counter stays closed (503) instead of
    // pooling such requests into one shared bucket.
    if (typeof address !== 'string' || !isIP(address)) throw new ServiceUnavailableError();
    return `ip:${ipKeyGenerator(address, 56)}`;
}

/**
 * Per-user quota key for provisioned, active accounts, so colleagues behind
 * one office NAT keep separate quotas. Requests without such a session use
 * the network key. The session lookup is memoized for authMiddleware.
 */
export async function principalRateLimitKey(req: Request): Promise<string> {
    const userId = (req as AuthRequest).user?.id;
    if (userId) return `user:${userId}`;
    if (SESSION_COOKIE.test(req.headers.cookie ?? '')) {
        try {
            const identity = await verifyRequestIdentity(req);
            // Pending sign-ups and deactivated accounts cannot use the API, so
            // they stay on the shared network quota.
            if (identity && identity.isActive !== false && archiveAccessProvisioningIssue({
                role: identity.role,
                unitKerjaId: identity.unitKerjaId,
            }) === null) {
                return `user:${identity.subject}`;
            }
        } catch {
            // An unavailable session lookup falls back to the network quota;
            // authMiddleware performs its own lookup and reports the failure.
        }
    }
    return networkRateLimitKey(req);
}
