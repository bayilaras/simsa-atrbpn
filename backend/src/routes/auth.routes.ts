import { Router, Request, Response } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from '../config/auth';
import { db } from '../config/database';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createLogger } from '../utils/logger';
import userManagementService from '../services/user-management.service.js';
import { AppError } from '../utils/errors.js';

const log = createLogger('AuthRoutes');

const router = Router();

// Custom endpoint to get user with role - MUST come before Better Auth handler
router.get('/me', async (req: Request, res: Response) => {
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
                user,
                session: {
                    id: session.session.id,
                    expiresAt: session.session.expiresAt,
                },
            },
        });
    } catch (error) {
        log.error({ err: error }, 'Auth /me error:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// List all users (admin only)
router.get('/users', async (req: Request, res: Response) => {
    try {
        const session = await auth.api.getSession({
            headers: req.headers as any,
        });

        if (!session) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        // Check if current user is admin
        const [currentUser] = await db
            .select({ role: users.role })
            .from(users)
            .where(eq(users.id, session.user.id))
            .limit(1);

        const adminRoles = ['super_admin', 'admin_dirjen', 'admin_sesditjen'];
        if (!adminRoles.includes(currentUser?.role || '')) {
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
        log.error({ err: error }, 'List users error:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update user role (super_admin only)
router.put('/users/:userId/role', async (req: Request, res: Response) => {
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
        const { role } = req.body;

        const validRoles = ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'user'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        const updatedUser = await userManagementService.updateUser(
            userId,
            { role },
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
        if (error instanceof AppError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        log.error({ err: error }, 'Update role error:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Better Auth handler - handles all auth routes
// POST /api/auth/sign-in/social - Initiate OAuth flow
// GET /api/auth/callback/google - OAuth callback
// GET /api/auth/session - Get current session
// POST /api/auth/sign-out - Sign out
// This MUST come last as it catches all remaining routes
router.all('/*', toNodeHandler(auth));

export default router;
