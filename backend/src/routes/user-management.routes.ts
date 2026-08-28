import { Router, Request, Response, NextFunction } from 'express';
import userManagementService from '../services/user-management.service';
import { listUsersSchema, updateUserSchema, userIdParamSchema, createUserSchema } from '../validations/user-management.validation';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { sensitiveLimiter } from '../middlewares/rate-limiter.middleware';
import { createLogger } from '../utils/logger';
import { AppError } from '../utils/errors.js';

const log = createLogger('UserManagementRoutes');

const router = Router();

// Apply rate limiting to user management operations
router.use(sensitiveLimiter);

// Authentication is deliberately centralized. Besides validating the Better Auth
// session, authMiddleware rejects deactivated and not-yet-provisioned `user`
// accounts before this module evaluates authorization.
router.use(authMiddleware);

function requireSuperAdmin(req: AuthRequest, res: Response, next: NextFunction) {
    if (req.user?.role !== 'super_admin') {
        return res.status(403).json({
            error: 'Access denied',
            message: 'Super admin access required'
        });
    }

    // Preserve the existing handler contract while sourcing identity only from the
    // centralized middleware, never from a second session/database implementation.
    (req as any).currentUser = req.user;
    next();
}

router.use(requireSuperAdmin);

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
router.get('/', async (req: Request, res: Response) => {
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
 * /api/users:
 *   post:
 *     summary: Create a new user (Super Admin only)
 *     tags: [User Management]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, name, role]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               name:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [super_admin, admin_dirjen, admin_sesditjen, user]
 *               unitKerjaId:
 *                 type: string
 *                 nullable: true
 *               jabatan:
 *                 type: string
 *                 nullable: true
 *               nip:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Validation error or email already exists
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const bodyResult = createUserSchema.safeParse(req.body);
        if (!bodyResult.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: bodyResult.error.issues
            });
        }

        const currentUser = (req as any).currentUser;
        const newUser = await userManagementService.createUser(bodyResult.data, {
            userId: currentUser.id,
            userEmail: currentUser.email || '',
            ipAddress: req.ip,
        });

        res.status(201).json({ success: true, data: newUser });
    } catch (error: any) {
        if (error instanceof AppError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        if (error.message?.includes('Email sudah terdaftar') || error.message?.includes('Invalid')) {
            return res.status(400).json({ error: error.message });
        }
        log.error({ err: error }, 'Create user error:');
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
router.get('/roles', async (req: Request, res: Response) => {
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
router.get('/unit-kerja', async (req: Request, res: Response) => {
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
router.get('/:userId', async (req: Request, res: Response) => {
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
router.put('/:userId', async (req: Request, res: Response) => {
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

        // Keep the current administrator capable of completing this request.
        // The service repeats these checks transactionally as defense in depth.
        const currentUser = (req as any).currentUser;
        if (paramResult.data.userId === currentUser.id) {
            if (bodyResult.data.isActive === false) {
                return res.status(400).json({
                    error: 'Anda tidak dapat menonaktifkan akun sendiri.'
                });
            }
            if (bodyResult.data.role !== undefined && bodyResult.data.role !== currentUser.role) {
                return res.status(400).json({
                    error: 'Anda tidak dapat mengubah peran akun sendiri.'
                });
            }
        }

        const updatedUser = await userManagementService.updateUser(
            paramResult.data.userId,
            bodyResult.data,
            { userId: currentUser.id, userEmail: currentUser.email, ipAddress: req.ip },
        );

        if (!updatedUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ success: true, data: updatedUser });
    } catch (error: any) {
        if (error instanceof AppError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        if (error.message?.includes('Invalid')) {
            return res.status(400).json({ error: error.message });
        }
        log.error({ err: error }, 'Update user error:');
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
router.delete('/:userId', async (req: Request, res: Response) => {
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

        const deactivatedUser = await userManagementService.deactivateUser(
            parseResult.data.userId,
            { userId: currentUser.id, userEmail: currentUser.email, ipAddress: req.ip },
        );
        if (!deactivatedUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ success: true, data: deactivatedUser, message: 'User deactivated' });
    } catch (error) {
        if (error instanceof AppError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        log.error({ err: error }, 'Deactivate user error:');
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
