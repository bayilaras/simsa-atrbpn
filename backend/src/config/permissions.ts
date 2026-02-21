/**
 * Permission Configuration Module
 * Granular permissions per module and action
 *
 * Role hierarchy:
 * - super_admin: Full access to ALL units + user management + settings
 * - admin_dirjen: Full access scoped to 'ditjen' unit kerja
 * - admin_sesditjen: Full access scoped to 'sesditjen' unit kerja
 * - staff: Read-only access scoped to their own unit kerja (assigned by super_admin)
 * - auditor: Read-only + export across all units
 * - user: NO access (default for new Google logins, awaiting role assignment)
 */

// Available roles in the system
export type Role = 'super_admin' | 'admin_dirjen' | 'admin_sesditjen' | 'staff' | 'auditor' | 'user';

// Available modules
export type Module =
    | 'surat_masuk'
    | 'surat_keluar'
    | 'arsip'
    | 'arsip_vital'
    | 'arsip_terjaga'
    | 'dosir'
    | 'audit_log'
    | 'user_management'
    | 'settings'
    | 'reports'
    | 'klasifikasi'
    | 'storage_locations';

// Available actions
export type Action = 'read' | 'create' | 'update' | 'delete' | 'archive' | 'destroy' | 'export';

// Shorthand for admin roles that have full CRUD (scoped by unit kerja)
const FULL_ADMIN: Role[] = ['super_admin', 'admin_dirjen', 'admin_sesditjen'];

// Permission matrix: which roles can perform which actions on which modules
// NOTE: admin_dirjen and admin_sesditjen have FULL access like super_admin,
// but data is scoped to their unit kerja via resolveUnitKerjaId() in routes.
export const PERMISSIONS: Record<Module, Partial<Record<Action, Role[]>>> = {
    surat_masuk: {
        read: [...FULL_ADMIN, 'staff', 'auditor'],
        create: FULL_ADMIN,
        update: FULL_ADMIN,
        delete: FULL_ADMIN,
        archive: FULL_ADMIN,
        export: [...FULL_ADMIN, 'auditor'],
    },
    surat_keluar: {
        read: [...FULL_ADMIN, 'staff', 'auditor'],
        create: FULL_ADMIN,
        update: FULL_ADMIN,
        delete: FULL_ADMIN,
        archive: FULL_ADMIN,
        export: [...FULL_ADMIN, 'auditor'],
    },
    arsip: {
        read: [...FULL_ADMIN, 'staff', 'auditor'],
        create: FULL_ADMIN,
        update: FULL_ADMIN,
        delete: FULL_ADMIN,
        destroy: ['super_admin'], // Only super_admin can permanently destroy archives
        export: [...FULL_ADMIN, 'auditor'],
    },
    arsip_vital: {
        read: [...FULL_ADMIN, 'staff', 'auditor'],
        create: FULL_ADMIN,
        update: FULL_ADMIN,
        delete: FULL_ADMIN,
        export: [...FULL_ADMIN, 'auditor'],
    },
    arsip_terjaga: {
        read: [...FULL_ADMIN, 'staff', 'auditor'],
        create: FULL_ADMIN,
        update: FULL_ADMIN,
        delete: FULL_ADMIN,
        export: [...FULL_ADMIN, 'auditor'],
    },
    dosir: {
        read: [...FULL_ADMIN, 'staff', 'auditor'],
        create: FULL_ADMIN,
        update: FULL_ADMIN,
        delete: FULL_ADMIN,
    },
    audit_log: {
        read: [...FULL_ADMIN, 'auditor'],
        export: ['super_admin', 'auditor'],
    },
    user_management: {
        read: ['super_admin'],
        create: ['super_admin'],
        update: ['super_admin'],
        delete: ['super_admin'],
    },
    settings: {
        read: ['super_admin'],
        update: ['super_admin'],
    },
    reports: {
        read: [...FULL_ADMIN, 'staff', 'auditor'],
        create: [...FULL_ADMIN, 'auditor'],
        export: [...FULL_ADMIN, 'auditor'],
    },
    klasifikasi: {
        read: [...FULL_ADMIN, 'staff', 'auditor'],
        create: ['super_admin'],
        update: ['super_admin'],
        delete: ['super_admin'],
    },
    storage_locations: {
        read: [...FULL_ADMIN, 'staff', 'auditor'],
        create: FULL_ADMIN,
        update: FULL_ADMIN,
        delete: ['super_admin'],
    },
};

// Role hierarchy - higher roles inherit permissions from lower roles
export const ROLE_HIERARCHY: Record<Role, number> = {
    'super_admin': 100,
    'admin_dirjen': 80,
    'admin_sesditjen': 60,
    'staff': 30,
    'auditor': 40,
    'user': 10, // Lowest — no access
};

// Unit kerja access by role (uses actual DB IDs from unit_kerja table)
export const UNIT_KERJA_ACCESS: Record<Role, string[] | '*'> = {
    'super_admin': '*', // Access to all units
    'admin_dirjen': ['ditjen'], // Dirjen unit only
    'admin_sesditjen': ['sesditjen', 'bagian_keuangan', 'bagian_kepegawaian', 'bagian_umum'], // Sesditjen + sub-bagian
    'staff': [], // Determined by user's unitKerjaId at runtime
    'auditor': '*', // Read access to all (but restricted to read-only by permissions)
    'user': [], // No access at all
};

/**
 * Check if a role has permission to perform an action on a module
 */
export function hasPermission(role: Role, module: Module, action: Action): boolean {
    const modulePerms = PERMISSIONS[module];
    if (!modulePerms) return false;

    const allowedRoles = modulePerms[action];
    if (!allowedRoles) return false;

    return allowedRoles.includes(role);
}

/**
 * Check if a role can access a specific unit kerja
 */
export function canAccessUnit(role: Role, userUnitKerjaId: string | null, targetUnitKerjaId: string): boolean {
    const accessConfig = UNIT_KERJA_ACCESS[role];

    // Wildcard access (super_admin, auditor)
    if (accessConfig === '*') return true;

    // user role has no access at all
    if (role === 'user') return false;

    // staff can only access their own assigned unit
    if (role === 'staff') {
        return userUnitKerjaId === targetUnitKerjaId;
    }

    // admin_dirjen / admin_sesditjen: check against their allowed units
    return accessConfig.includes(targetUnitKerjaId);
}

/**
 * Get all allowed actions for a role on a module
 */
export function getAllowedActions(role: Role, module: Module): Action[] {
    const modulePerms = PERMISSIONS[module];
    if (!modulePerms) return [];

    return (Object.entries(modulePerms) as [Action, Role[]][])
        .filter(([_, roles]) => roles.includes(role))
        .map(([action]) => action);
}

/**
 * Check if role is read-only (cannot create/update/delete)
 */
export function isReadOnlyRole(role: Role): boolean {
    return role === 'auditor' || role === 'staff' || role === 'user';
}

/**
 * Check if role has zero access (new users awaiting role assignment)
 */
export function isNoAccessRole(role: Role): boolean {
    return role === 'user';
}
