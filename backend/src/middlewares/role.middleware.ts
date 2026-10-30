import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { hasPermission, isReadOnlyRole, isNoAccessRole, Role, Module, Action } from '../config/permissions';

// Re-export types for convenience
export type { Role, Module, Action } from '../config/permissions';

// Legacy role hierarchy for backward compatibility
const ROLE_PERMISSIONS: Record<Role, string[]> = {
    'super_admin': ['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor', 'user'],
    'admin_unit': ['admin_unit', 'staff', 'user'],
    'admin_dirjen': ['admin_dirjen', 'staff', 'user'],
    'admin_sesditjen': ['admin_sesditjen', 'staff', 'user'],
    'staff': ['staff', 'user'],
    'auditor': ['auditor'],
    'user': ['user'],
};

function missingUnitMandate(req: AuthRequest): boolean {
    return ['admin_unit', 'staff', 'auditor'].includes(req.user?.role || '')
        && !req.user?.unitKerjaId?.trim();
}

/**
 * Check if user can write (create/update/delete) - read-only roles are blocked
 */
export function canWriteMiddleware() {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const userRole = req.user.role as Role;

        if (isReadOnlyRole(userRole) || missingUnitMandate(req)) {
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
        if (isNoAccessRole(req.user.role as Role) || missingUnitMandate(req)) {
            return res.status(403).json({ error: 'Forbidden' });
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
        const hasRole = !isNoAccessRole(userRole) && allowedRoles.some(role =>
            ROLE_PERMISSIONS[userRole]?.includes(role)
        );

        if (!hasRole || isNoAccessRole(userRole) || missingUnitMandate(req)) {
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

        if (!hasPermission(userRole, module, action) || missingUnitMandate(req)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `You do not have permission to ${action} ${module.replace('_', ' ')}`
            });
        }

        next();
    };
}
