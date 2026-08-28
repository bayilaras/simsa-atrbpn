import { Request, Response, NextFunction } from 'express';
import { auth } from '../config/auth';
import { db } from '../config/database';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createLogger } from '../utils/logger';
import { resolveEffectiveUnitKerjaId } from '../utils/resolve-unit-kerja.js';
import type { Role } from '../config/permissions.js';

const log = createLogger('AuthMiddleware');
const PROVISIONED_ROLES = new Set([
    'super_admin',
    'admin_dirjen',
    'admin_sesditjen',
    'staff',
    'auditor',
]);

export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
        name: string | null;
        role: string;
        unitKerjaId: string | null;
    };
}

export async function authMiddleware(
    req: AuthRequest,
    res: Response,
    next: NextFunction
) {
    try {
        // Use Better Auth to validate session
        const session = await auth.api.getSession({
            headers: req.headers as any,
        });

        if (!session) {
            return res.status(401).json({ error: 'Unauthorized: No valid session' });
        }

        // Get user with role from database
        const [user] = await db
            .select({
                id: users.id,
                email: users.email,
                name: users.name,
                role: users.role,
                unitKerjaId: users.unitKerjaId,
                isActive: users.isActive,
            })
            .from(users)
            .where(eq(users.id, session.user.id))
            .limit(1);

        if (!user) {
            return res.status(401).json({ error: 'Unauthorized: User not found' });
        }

        // Deactivating a user does not revoke their Better Auth session, so a
        // soft-deleted account stays authenticated until expiry unless blocked here.
        const { isActive, ...authUser } = user;
        if (isActive === false) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Akun Anda telah dinonaktifkan. Hubungi administrator.',
            });
        }

        // New social-login accounts intentionally start with the `user` role while
        // an administrator assigns an organisational role. Authentication alone is
        // not authorisation: fail closed here so a forgotten route-level permission
        // cannot expose records to an unprovisioned account.
        if (!PROVISIONED_ROLES.has(authUser.role)) {
            return res.status(403).json({
                error: 'Access pending',
                message: 'Akun belum memiliki role kearsipan. Hubungi administrator.',
            });
        }

        // Staff queries are scoped with unitKerjaId. Letting an unassigned staff
        // account continue would turn a missing filter into an all-unit query in a
        // number of services, so incomplete provisioning must also fail closed.
        if (['staff', 'auditor'].includes(authUser.role) && !authUser.unitKerjaId) {
            return res.status(403).json({
                error: 'Unit kerja required',
                message: 'Akun belum memiliki mandat unit kerja. Hubungi administrator.',
            });
        }

        req.user = {
            ...authUser,
            unitKerjaId: resolveEffectiveUnitKerjaId(
                authUser.role as Role,
                authUser.unitKerjaId,
            ),
        };
        next();
    } catch (error) {
        log.error({ err: error }, 'Auth middleware error');
        res.status(500).json({ error: 'Internal server error' });
    }
}

// Optional auth - doesn't require authentication but attaches user if present
export async function optionalAuthMiddleware(
    req: AuthRequest,
    res: Response,
    next: NextFunction
) {
    try {
        const session = await auth.api.getSession({
            headers: req.headers as any,
        });

        if (session) {
            const [user] = await db
                .select({
                    id: users.id,
                    email: users.email,
                    name: users.name,
                    role: users.role,
                    unitKerjaId: users.unitKerjaId,
                    isActive: users.isActive,
                })
                .from(users)
                .where(eq(users.id, session.user.id))
                .limit(1);

            if (user) {
                const { isActive, ...authUser } = user;
                if (isActive !== false) {
                    req.user = {
                        ...authUser,
                        unitKerjaId: resolveEffectiveUnitKerjaId(
                            authUser.role as Role,
                            authUser.unitKerjaId,
                        ),
                    };
                }
            }
        }

        next();
    } catch (error) {
        // Silently continue without auth
        next();
    }
}
