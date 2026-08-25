/**
 * Resolve the effective unitKerjaId for queries based on the user's role.
 *
 * This enforces unit kerja isolation:
 * - super_admin: can query any unit (via query param) or null = all
 * - admin_dirjen: always forced to 'ditjen'
 * - admin_sesditjen: always forced to 'sesditjen'
 * - staff: forced to their assigned unitKerjaId
 * - auditor: forced to the explicitly assigned audit-mandate unit
 * - user: forced to their assigned unitKerjaId (but has no read permissions anyway)
 */
import { AuthRequest } from '../middlewares/auth.middleware.js';
import type { Role } from '../config/permissions.js';

export function resolveUnitKerjaId(req: AuthRequest): string | null {
    const role = (req.user?.role || 'user') as Role;
    const userUnitKerjaId = req.user?.unitKerjaId || null;
    const queryUnitKerjaId = (req.query?.unitKerjaId as string) || null;

    switch (role) {
        case 'super_admin':
            // Super admin can query any unit, or null = all data
            return queryUnitKerjaId || null;

        case 'admin_dirjen':
            // Always scoped to ditjen — ignore query param
            return 'ditjen';

        case 'admin_sesditjen':
            // Always scoped to sesditjen — ignore query param
            return 'sesditjen';

        case 'auditor':
            // Cross-unit access requires an explicit mandate/approval model. Until
            // that exists, an auditor is scoped like other assigned-unit users.
            return userUnitKerjaId;

        case 'staff':
            // Staff can only see their own assigned unit
            return userUnitKerjaId;

        case 'user':
        default:
            // User has no access, but resolve to their unit just in case
            return userUnitKerjaId;
    }
}
