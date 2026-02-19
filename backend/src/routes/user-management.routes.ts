import { Router, Request, Response } from 'express';
import { auth } from '../config/auth';
import { db } from '../config/database';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import userManagementService, { ADMIN_ROLES } from '../services/user-management.service';
import { listUsersSchema, updateUserSchema, userIdParamSchema } from '../validations/user-management.validation';
import auditLogService from '../services/audit-log.service';
import { sensitiveLimiter } from '../middlewares/rate-limiter.middleware';
import { createLogger } from '../utils/logger';

const log = createLogger('UserManagementRoutes');

const router = Router();

// Apply rate limiting to user management operations
router.use(sensitiveLimiter);

// Middleware to check if user is admin
async function requireAdmin(req: Request, res: Response, next: any) {
    try {
        const session = await auth.api.getSession({
            headers: req.headers as any,
        });

        if (!session) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        // Get user role
        const [currentUser] = await db
            .select({ role: users.role })
            .from(users)
            .where(eq(users.id, session.user.id))
            .limit(1);

        if (!currentUser || !ADMIN_ROLES.includes(currentUser.role as any)) {
            return res.status(403).json({
                error: 'Access denied',
                message: 'Super admin access required'
            });
        }

        // Attach user to request
        (req as any).currentUser = { id: session.user.id, role: currentUser.role };
        next();
    } catch (error) {
        log.error({ err: error }, 'Auth check error:');
        res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: List all users with filters
 *     tags: [User Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name or email
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [super_admin, admin_dirjen, admin_sesditjen, user]
 *       - in: query
 *         name: unitKerjaId
 *         schema:
 *           type: string
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: List of users with pagination
 */
router.get('/', requireAdmin, async (req: Request, res: Response) => {
    try {
        const parseResult = listUsersSchema.safeParse(req.query);
        if (!parseResult.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parseResult.error.issues
            });
        }

        const result = await userManagementService.listUsers(parseResult.data);
        res.json({ success: true, ...result });
    } catch (error) {
        log.error({ err: error }, 'List users error:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/users/roles:
 *   get:
 *     summary: Get available roles
 *     tags: [User Management]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of available roles
 */
router.get('/roles', requireAdmin, async (req: Request, res: Response) => {
    try {
        const roles = userManagementService.getRoles();
        res.json({ success: true, data: roles });
    } catch (error) {
        log.error({ err: error }, 'Get roles error:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/users/unit-kerja:
 *   get:
 *     summary: Get available unit kerja for assignment
 *     tags: [User Management]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of unit kerja
 */
router.get('/unit-kerja', requireAdmin, async (req: Request, res: Response) => {
    try {
        const unitKerjaList = await userManagementService.listUnitKerja();
        res.json({ success: true, data: unitKerjaList });
    } catch (error) {
        log.error({ err: error }, 'Get unit kerja error:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/users/{userId}:
 *   get:
 *     summary: Get user by ID
 *     tags: [User Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: User details
 *       404:
 *         description: User not found
 */
router.get('/:userId', requireAdmin, async (req: Request, res: Response) => {
    try {
        const parseResult = userIdParamSchema.safeParse(req.params);
        if (!parseResult.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parseResult.error.issues
            });
        }

        const user = await userManagementService.getUserById(parseResult.data.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ success: true, data: user });
    } catch (error) {
        log.error({ err: error }, 'Get user error:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/users/{userId}:
 *   put:
 *     summary: Update user (role, unit kerja, status)
 *     tags: [User Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [super_admin, admin_dirjen, admin_sesditjen, user]
 *               unitKerjaId:
 *                 type: string
 *                 nullable: true
 *               isActive:
 *                 type: boolean
 *               jabatan:
 *                 type: string
 *                 nullable: true
 *                 maxLength: 100
 *                 description: Job title/position (e.g. Arsiparis)
 *               nip:
 *                 type: string
 *                 nullable: true
 *                 maxLength: 30
 *                 description: Nomor Induk Pegawai
 *     responses:
 *       200:
 *         description: User updated successfully
 */
router.put('/:userId', requireAdmin, async (req: Request, res: Response) => {
    try {
        const paramResult = userIdParamSchema.safeParse(req.params);
        if (!paramResult.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: paramResult.error.issues
            });
        }

        const bodyResult = updateUserSchema.safeParse(req.body);
        if (!bodyResult.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: bodyResult.error.issues
            });
        }

        // Prevent self-demotion from super_admin
        const currentUser = (req as any).currentUser;
        if (paramResult.data.userId === currentUser.id && bodyResult.data.role !== 'super_admin') {
            return res.status(400).json({
                error: 'Cannot change your own role'
            });
        }

        const existingUser = await userManagementService.getUserById(paramResult.data.userId);
        const updatedUser = await userManagementService.updateUser(
            paramResult.data.userId,
            bodyResult.data
        );

        if (!updatedUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Log audit
        await auditLogService.logAction({
            userId: currentUser.id,
            userEmail: currentUser.email,
            action: 'update',
            entityType: 'user',
            entityId: paramResult.data.userId,
            changes: {
                before: { role: existingUser?.role, unitKerjaId: existingUser?.unitKerjaId, isActive: existingUser?.isActive },
                after: { role: updatedUser.role, unitKerjaId: updatedUser.unitKerjaId, isActive: updatedUser.isActive },
                fields: Object.keys(bodyResult.data)
            },
            ipAddress: req.ip,
        });

        res.json({ success: true, data: updatedUser });
    } catch (error: any) {
        log.error({ err: error }, 'Update user error:');
        if (error.message?.includes('Invalid')) {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/users/{userId}:
 *   delete:
 *     summary: Deactivate user (soft delete)
 *     tags: [User Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: User deactivated successfully
 */
router.delete('/:userId', requireAdmin, async (req: Request, res: Response) => {
    try {
        const parseResult = userIdParamSchema.safeParse(req.params);
        if (!parseResult.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: parseResult.error.issues
            });
        }

        // Prevent self-deactivation
        const currentUser = (req as any).currentUser;
        if (parseResult.data.userId === currentUser.id) {
            return res.status(400).json({
                error: 'Cannot deactivate your own account'
            });
        }

        const deactivatedUser = await userManagementService.deactivateUser(parseResult.data.userId);
        if (!deactivatedUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Log audit
        await auditLogService.logAction({
            userId: currentUser.id,
            userEmail: currentUser.email,
            action: 'update',
            entityType: 'user',
            entityId: parseResult.data.userId,
            changes: { after: { isActive: false } },
            ipAddress: req.ip,
        });

        res.json({ success: true, data: deactivatedUser, message: 'User deactivated' });
    } catch (error) {
        log.error({ err: error }, 'Deactivate user error:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
