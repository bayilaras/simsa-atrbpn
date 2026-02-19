import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { hasPermission, canAccessUnit, isReadOnlyRole, Role, Module, Action } from '../config/permissions';

// Re-export types for convenience
export type { Role, Module, Action } from '../config/permissions';

// Legacy role hierarchy for backward compatibility
const ROLE_PERMISSIONS: Record<Role, string[]> = {
    'super_admin': ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor', 'user'],
    'admin_dirjen': ['admin_dirjen', 'user'],
    'admin_sesditjen': ['admin_sesditjen', 'user'],
    'auditor': ['auditor'],
    'user': ['user'],
};

/**
 * Check if user can write (create/update/delete) - read-only roles are blocked
 */
export function canWriteMiddleware() {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const userRole = req.user.role as Role;

        if (isReadOnlyRole(userRole)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Read-only access. You cannot modify data.'
            });
        }

        next();
    };
}

/**
 * Check if user can read - essentially just valid auth for now
 */
export function canReadMiddleware() {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
    };
}

/**
 * Legacy role middleware - checks if user has one of the allowed roles
 */
export function roleMiddleware(allowedRoles: Role[]) {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const userRole = req.user.role as Role;

        // Check if user's role or any role they inherit is allowed
        const hasRole = allowedRoles.some(role =>
            ROLE_PERMISSIONS[userRole]?.includes(role)
        );

        if (!hasRole) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'You do not have permission to access this resource'
            });
        }

        next();
    };
}

/**
 * NEW: Permission middleware - granular module+action based permissions
 * Usage: permissionMiddleware('surat_masuk', 'create')
 */
export function permissionMiddleware(module: Module, action: Action) {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const userRole = req.user.role as Role;

        if (!hasPermission(userRole, module, action)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `You do not have permission to ${action} ${module.replace('_', ' ')}`
            });
        }

        next();
    };
}

/**
 * NEW: Unit kerja access middleware - ensures user can only access their allowed units
 */
export function unitKerjaMiddleware(paramName: string = 'unitKerjaId') {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const targetUnitKerjaId = req.params[paramName] || req.body[paramName] || req.query[paramName];

        // If no unit specified, let the route handle it
        if (!targetUnitKerjaId) {
            return next();
        }

        const userRole = req.user.role as Role;
        const userUnitKerjaId = req.user.unitKerjaId || null;

        if (!canAccessUnit(userRole, userUnitKerjaId, targetUnitKerjaId as string)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `You do not have access to unit: ${targetUnitKerjaId}`
            });
        }

        next();
    };
}

/**
 * Legacy unit access middleware (backward compatible)
 */
export function unitAccessMiddleware(paramName: string = 'unitKerjaId') {
    return unitKerjaMiddleware(paramName);
}

/**
 * Combine multiple permission checks - all must pass
 */
export function requireAll(...middlewares: ((req: AuthRequest, res: Response, next: NextFunction) => void)[]) {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        for (const middleware of middlewares) {
            let passed = false;
            let error: any = null;

            await new Promise<void>((resolve) => {
                middleware(req, res, (err?: any) => {
                    if (err) {
                        error = err;
                    } else if (!res.headersSent) {
                        passed = true;
                    }
                    resolve();
                });
            });

            if (!passed) {
                if (error) next(error);
                return; // Response already sent by middleware
            }
        }
        next();
    };
}
