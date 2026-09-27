import { PERAN_FULL_ADMIN, unitJangkauan } from '../access/visibility-spec.js';

export const FULL_ADMIN_ROLES: ReadonlySet<string> = new Set<string>(PERAN_FULL_ADMIN);

export function isFullAdmin(user: { role?: string | null } | null | undefined): boolean {
    return FULL_ADMIN_ROLES.has(user?.role ?? '');
}

/** Unit efektif (mandat role admin_dirjen/sesditjen; super_admin tanpa unit → null), dihitung P2. */
export const unitEfektif = unitJangkauan;
