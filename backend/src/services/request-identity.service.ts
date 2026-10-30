import type { Request } from 'express';

export interface VerifiedRequestIdentity {
    subject: string;
    email?: string;
    name?: string;
}

export async function verifyRequestIdentity(
    req: Request,
): Promise<VerifiedRequestIdentity | null> {
    const { auth } = await import('../config/auth.js');
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session) return null;
    return {
        subject: session.user.id,
        email: session.user.email,
        name: session.user.name,
    };
}
