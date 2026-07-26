import { Request, Response, NextFunction } from 'express';
import { auth } from '../config/auth';
import { db } from '../config/database';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createLogger } from '../utils/logger';

const log = createLogger('AuthMiddleware');

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

        req.user = authUser;
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
                    req.user = authUser;
                }
            }
        }

        next();
    } catch (error) {
        // Silently continue without auth
        next();
    }
}
