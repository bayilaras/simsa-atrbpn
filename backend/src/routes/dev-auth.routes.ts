import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { env } from '../config/env';
import { auth } from '../config/auth';
import { authLimiter } from '../middlewares/rate-limiter.middleware';
import { createLogger } from '../utils/logger';

const log = createLogger('DevAuthRoutes');

const router = Router();

// Apply rate limiting to dev auth routes
router.use(authLimiter);
/**
 * ⚠️ SECURITY WARNING ⚠️
 * This endpoint bypasses password verification and should NEVER be available in production.
 * It is protected by NODE_ENV check below - do not remove this guard.
 */
router.post('/dev-login', async (req: Request, res: Response) => {
    // CRITICAL: Only allow in development environment
    if (env.NODE_ENV !== 'development') {
        res.status(403).json({
            error: 'Forbidden',
            message: 'Dev login is only available in development environment'
        });
        return;
    }
    const { email } = req.body;

    if (!email) {
        res.status(400).json({ error: 'Email is required' });
        return;
    }

    try {
        // Find user by email
        const user = await db.query.users.findFirst({
            where: eq(users.email, email),
        });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        // Use Better Auth's internal API to create a properly formatted session
        // This ensures the session token is stored in the format Better Auth expects
        const session = await auth.api.signInEmail({
            body: {
                email: email,
                password: 'dev-bypass', // Will be overridden below
            },
            asResponse: false,
        }).catch(() => null);

        // If Better Auth sign-in fails (wrong password, etc), create session directly
        // via Better Auth's internal session management
        if (!session) {
            // Fallback: Use internal session creation
            // Generate headers for the response
            const headers = new Headers();

            // Create a session token using Better Auth's session management
            const internalCtx = await (auth as any).internal?.createSession?.({
                userId: user.id,
                request: req,
            }).catch(() => null);

            if (internalCtx) {
                // If internal session creation worked, set the cookie
                const token = internalCtx.token || internalCtx.session?.token;
                if (token) {
                    res.cookie('better-auth.session_token', token, {
                        httpOnly: true,
                        secure: false,
                        sameSite: 'lax',
                        maxAge: 7 * 24 * 60 * 60 * 1000,
                    });

                    res.json({
                        success: true,
                        user: {
                            id: user.id,
                            email: user.email,
                            name: user.name,
                            role: user.role,
                        },
                        token: token,
                    });
                    return;
                }
            }

            // Last resort: manually insert session (may not work with get-session)
            const { v4: uuidv4 } = await import('uuid');
            const token = uuidv4();
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7);

            const { sessions } = await import('../db/schema');
            await db.insert(sessions).values({
                userId: user.id,
                token: token,
                expiresAt: expiresAt,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            res.cookie('better-auth.session_token', token, {
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000,
            });

            res.json({
                success: true,
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                },
                token: token,
            });
            return;
        }

        // If Better Auth sign-in succeeded, response already has cookies set
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
            },
        });
    } catch (error) {
        log.error({ err: error }, 'Dev login error:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
