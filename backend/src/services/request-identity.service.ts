import type { Request, Response } from 'express';

export interface VerifiedRequestIdentity {
    subject: string;
    email?: string;
    name?: string;
    // Session snapshot used only for rate-limit keying. authMiddleware keeps
    // reading role, unit and activation from the database on every request.
    role: string;
    unitKerjaId: string | null;
    isActive: boolean;
}

// One session lookup per request: the rate limiter and authMiddleware share
// it. A rejected lookup is dropped so a later caller can retry.
const identityLookups = new WeakMap<Request, Promise<VerifiedRequestIdentity | null>>();
// Session cookies Better Auth set during a lookup: the renewed cookie of a
// session it extended, or the removal of an expired one.
const sessionCookies = new WeakMap<Request, string[]>();

async function lookupRequestIdentity(
    req: Request,
): Promise<VerifiedRequestIdentity | null> {
    const { auth } = await import('../config/auth.js');
    const { headers, response: session } = await auth.api.getSession({
        headers: req.headers as any,
        returnHeaders: true,
    });
    const cookies = headers?.getSetCookie() ?? [];
    if (cookies.length > 0) sessionCookies.set(req, cookies);
    if (!session) return null;
    const { user } = session;
    return {
        subject: user.id,
        email: user.email,
        name: user.name,
        role: String(user.role || 'user'),
        unitKerjaId: typeof user.unitKerjaId === 'string' ? user.unitKerjaId : null,
        isActive: user.isActive !== false,
    };
}

export function verifyRequestIdentity(
    req: Request,
): Promise<VerifiedRequestIdentity | null> {
    const pending = identityLookups.get(req);
    if (pending) return pending;
    const lookup = lookupRequestIdentity(req);
    identityLookups.set(req, lookup);
    lookup.catch(() => {
        if (identityLookups.get(req) === lookup) identityLookups.delete(req);
    });
    return lookup;
}

/**
 * Passes the session cookie from this request's lookup on to the browser.
 * The cookie lives exactly as long as the session, so a session extended
 * while the browser keeps an older cookie would still end for the user.
 */
export function forwardSessionCookies(req: Request, res: Response): void {
    const cookies = sessionCookies.get(req);
    if (!cookies) return;
    sessionCookies.delete(req);
    for (const cookie of cookies) res.append('Set-Cookie', cookie);
}
