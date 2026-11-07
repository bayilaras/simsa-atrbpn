import type { Request } from 'express';

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

async function lookupRequestIdentity(
    req: Request,
): Promise<VerifiedRequestIdentity | null> {
    const { auth } = await import('../config/auth.js');
    const session = await auth.api.getSession({ headers: req.headers as any });
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
