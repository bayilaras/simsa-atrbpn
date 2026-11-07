import { Router, Request, Response, NextFunction } from 'express';
import userManagementService, { SELF_PASSWORD_RESET_MESSAGE } from '../services/user-management.service';
import {
    listUsersSchema,
    updateUserSchema,
    userIdParamSchema,
    createUserSchema,
    resetPasswordSchema,
} from '../validations/user-management.validation';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { sensitiveLimiter } from '../middlewares/rate-limiter.middleware';

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

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
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
        next(error);
    }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
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
    } catch (error) {
        next(error);
    }
});

router.get('/roles', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const roles = userManagementService.getRoles();
        res.json({ success: true, data: roles });
    } catch (error) {
        next(error);
    }
});

router.get('/unit-kerja', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const unitKerjaList = await userManagementService.listUnitKerja();
        res.json({ success: true, data: unitKerjaList });
    } catch (error) {
        next(error);
    }
});

router.get('/:userId', async (req: Request, res: Response, next: NextFunction) => {
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
        next(error);
    }
});

router.put('/:userId', async (req: Request, res: Response, next: NextFunction) => {
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
    } catch (error) {
        next(error);
    }
});

router.post('/:userId/password', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const paramResult = userIdParamSchema.safeParse(req.params);
        if (!paramResult.success) {
            return res.status(400).json({
                error: 'Validation error',
                details: paramResult.error.issues
            });
        }

        // Zod issues carry the rule and path, never the submitted value.
        const bodyResult = resetPasswordSchema.safeParse(req.body);
        if (!bodyResult.success) {
            return res.status(400).json({
                error: 'Validation error',
                message: bodyResult.error.issues[0]?.message,
                details: bodyResult.error.issues
            });
        }

        const currentUser = (req as any).currentUser;
        if (paramResult.data.userId === currentUser.id) {
            return res.status(400).json({ error: SELF_PASSWORD_RESET_MESSAGE });
        }

        const result = await userManagementService.resetPassword(
            paramResult.data.userId,
            bodyResult.data.newPassword,
            { userId: currentUser.id, userEmail: currentUser.email, ipAddress: req.ip },
        );
        if (!result) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            success: true,
            data: result,
            message: 'Kata sandi diatur ulang. Pengguna perlu masuk kembali dengan kata sandi baru.',
        });
    } catch (error) {
        next(error);
    }
});

router.delete('/:userId', async (req: Request, res: Response, next: NextFunction) => {
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
        next(error);
    }
});

export default router;
