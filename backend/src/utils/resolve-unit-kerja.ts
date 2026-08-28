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
import type { AuthRequest } from '../middlewares/auth.middleware.js';
import type { Role } from '../config/permissions.js';

export const ROLE_MANDATED_UNIT_KERJA: Readonly<Partial<Record<Role, string>>> = Object.freeze({
    admin_dirjen: 'ditjen',
    admin_sesditjen: 'sesditjen',
});

/**
 * Resolve a unit from an actor's immutable role mandate. Fixed-role
 * administrators never inherit a nullable or stale database assignment and a
 * caller-supplied unit can never widen their scope.
 */
export function resolveEffectiveUnitKerjaId(
    role: Role,
    assignedUnitKerjaId: string | null | undefined,
    requestedUnitKerjaId: string | null | undefined = null,
): string | null {
    const mandated = ROLE_MANDATED_UNIT_KERJA[role];
    if (mandated) return mandated;

    if (role === 'super_admin') {
        return requestedUnitKerjaId?.trim() || null;
    }

    return assignedUnitKerjaId?.trim() || null;
}

export function resolveUnitKerjaId(req: AuthRequest): string | null {
    const role = (req.user?.role || 'user') as Role;
    const userUnitKerjaId = req.user?.unitKerjaId || null;
    const queryUnitKerjaId = (req.query?.unitKerjaId as string) || null;
    return resolveEffectiveUnitKerjaId(role, userUnitKerjaId, queryUnitKerjaId);
}
