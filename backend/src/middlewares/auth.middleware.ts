import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';
import { resolveEffectiveUnitKerjaId } from '../utils/resolve-unit-kerja.js';
import type { Role } from '../config/permissions.js';
import { verifyRequestIdentity } from '../services/request-identity.service.js';
import {
    archiveAccessProvisioningIssue,
    findProvisionedIdentityUser,
} from '../services/identity-user.service.js';

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
        const identity = await verifyRequestIdentity(req);

        if (!identity) {
            return res.status(401).json({ error: 'Unauthorized: No valid session' });
        }

        if (identity.provider === 'firebase' && identity.emailVerified !== true) {
            return res.status(403).json({
                error: 'Email verification required',
                message: 'Verifikasi email Firebase diperlukan sebelum mengakses SIMSA.',
            });
        }

        const user = await findProvisionedIdentityUser(identity);

        if (!user) {
            return res.status(401).json({ error: 'Unauthorized: User not found' });
        }

        // Deactivating a user does not revoke their Better Auth session, so a
        // soft-deleted account stays authenticated until expiry unless blocked here.
        const { isActive, firebaseUid: _firebaseUid, ...authUser } = user;
        void _firebaseUid;
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
        const provisioningIssue = archiveAccessProvisioningIssue(authUser);
        if (provisioningIssue === 'role') {
            return res.status(403).json({
                error: 'Access pending',
                message: 'Akun belum memiliki role kearsipan. Hubungi administrator.',
            });
        }

        // Staff queries are scoped with unitKerjaId. Letting an unassigned staff
        // account continue would turn a missing filter into an all-unit query in a
        // number of services, so incomplete provisioning must also fail closed.
        if (provisioningIssue === 'unit') {
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
        if (String((error as { code?: unknown }).code || '').startsWith('auth/')) {
            res.status(401).json({ error: 'Unauthorized: Invalid or revoked Firebase session' });
            return;
        }
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
        const identity = await verifyRequestIdentity(req);

        if (identity && (identity.provider !== 'firebase' || identity.emailVerified === true)) {
            const user = await findProvisionedIdentityUser(identity);

            if (user) {
                const { isActive, firebaseUid: _firebaseUid, ...authUser } = user;
                void _firebaseUid;
                if (isActive !== false && archiveAccessProvisioningIssue(authUser) === null) {
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
