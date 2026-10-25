import { Router, Request, Response, NextFunction } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from '../config/auth';
import { db } from '../config/database';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import userManagementService from '../services/user-management.service.js';
import { updateUserSchema } from '../validations/user-management.validation.js';
import { resolveEffectiveUnitKerjaId } from '../utils/resolve-unit-kerja.js';
import type { Role } from '../config/permissions.js';

const router = Router();

// Custom endpoint to get user with role - MUST come before Better Auth handler
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const session = await auth.api.getSession({
            headers: req.headers as any,
        });

        if (!session) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        // Get user with role from database
        const [user] = await db
            .select({
                id: users.id,
                email: users.email,
                name: users.name,
                image: users.image,
                role: users.role,
                unitKerjaId: users.unitKerjaId,
                isActive: users.isActive,
            })
            .from(users)
            .where(eq(users.id, session.user.id))
            .limit(1);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            success: true,
            data: {
                user: { ...user, unitKerjaId: resolveEffectiveUnitKerjaId(user.role as Role, user.unitKerjaId) },
                session: {
                    id: session.session.id,
                    expiresAt: session.session.expiresAt,
                },
            },
        });
    } catch (error) {
        next(error);
    }
});

// List all users (admin only)
router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const session = await auth.api.getSession({
            headers: req.headers as any,
        });

        if (!session) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        // Check if current user is admin
        const [currentUser] = await db
            .select({ role: users.role, isActive: users.isActive })
            .from(users)
            .where(eq(users.id, session.user.id))
            .limit(1);

        if (currentUser?.role !== 'super_admin' || currentUser.isActive === false) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const allUsers = await db
            .select({
                id: users.id,
                email: users.email,
                name: users.name,
                image: users.image,
                role: users.role,
                createdAt: users.createdAt,
            })
            .from(users)
            .orderBy(users.createdAt);

        res.json({ success: true, data: allUsers });
    } catch (error) {
        next(error);
    }
});

// Update user role (super_admin only)
router.put('/users/:userId/role', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const session = await auth.api.getSession({
            headers: req.headers as any,
        });

        if (!session) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        // Check if current user is super_admin
        const [currentUser] = await db
            .select({ role: users.role })
            .from(users)
            .where(eq(users.id, session.user.id))
            .limit(1);

        if (currentUser?.role !== 'super_admin') {
            return res.status(403).json({ error: 'Only super_admin can update roles' });
        }

        const userId = req.params.userId as string;
        const parsed = updateUserSchema.safeParse(req.body);
        if (!parsed.success || !parsed.data.role) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        const updatedUser = await userManagementService.updateUser(
            userId,
            { role: parsed.data.role, ...(parsed.data.unitKerjaId !== undefined ? { unitKerjaId: parsed.data.unitKerjaId } : {}) },
            {
                userId: session.user.id,
                userEmail: session.user.email,
                ipAddress: req.ip,
            },
        );

        if (!updatedUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ success: true, data: updatedUser });
    } catch (error) {
        next(error);
    }
});

// Better Auth handler - handles all auth routes
// POST /api/auth/sign-in/social - Initiate OAuth flow
// GET /api/auth/callback/google - OAuth callback
// GET /api/auth/session - Get current session
// POST /api/auth/sign-out - Sign out
// This MUST come last as it catches all remaining routes
router.all('/{*splat}', toNodeHandler(auth));

export default router;
