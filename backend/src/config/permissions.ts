/**
 * Permission Configuration Module
 * Granular permissions per module and action
 */

// Available roles in the system
export type Role = 'super_admin' | 'admin_dirjen' | 'admin_sesditjen' | 'auditor' | 'user';

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

// Permission matrix: which roles can perform which actions on which modules
export const PERMISSIONS: Record<Module, Partial<Record<Action, Role[]>>> = {
    surat_masuk: {
        read: ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor', 'user'],
        create: ['super_admin', 'admin_dirjen', 'admin_sesditjen'],
        update: ['super_admin', 'admin_dirjen', 'admin_sesditjen'],
        delete: ['super_admin', 'admin_dirjen'],
        archive: ['super_admin', 'admin_dirjen', 'admin_sesditjen'],
        export: ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor'],
    },
    surat_keluar: {
        read: ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor', 'user'],
        create: ['super_admin', 'admin_dirjen', 'admin_sesditjen'],
        update: ['super_admin', 'admin_dirjen', 'admin_sesditjen'],
        delete: ['super_admin', 'admin_dirjen'],
        archive: ['super_admin', 'admin_dirjen', 'admin_sesditjen'],
        export: ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor'],
    },
    arsip: {
        read: ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor', 'user'],
        create: ['super_admin', 'admin_dirjen', 'admin_sesditjen'],
        update: ['super_admin', 'admin_dirjen', 'admin_sesditjen'],
        delete: ['super_admin', 'admin_dirjen'],
        destroy: ['super_admin'], // Only super_admin can destroy archives
        export: ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor'],
    },
    arsip_vital: {
        read: ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor', 'user'],
        create: ['super_admin', 'admin_dirjen', 'admin_sesditjen'],
        update: ['super_admin', 'admin_dirjen', 'admin_sesditjen'],
        delete: ['super_admin', 'admin_dirjen'],
        export: ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor'],
    },
    arsip_terjaga: {
        read: ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor', 'user'],
        create: ['super_admin', 'admin_dirjen', 'admin_sesditjen'],
        update: ['super_admin', 'admin_dirjen', 'admin_sesditjen'],
        delete: ['super_admin', 'admin_dirjen'],
        export: ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor'],
    },
    dosir: {
        read: ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor', 'user'],
        create: ['super_admin', 'admin_dirjen', 'admin_sesditjen'],
        update: ['super_admin', 'admin_dirjen', 'admin_sesditjen'],
        delete: ['super_admin', 'admin_dirjen'],
    },
    audit_log: {
        read: ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor'],
        export: ['super_admin', 'auditor'],
    },
    user_management: {
        read: ['super_admin', 'admin_dirjen', 'admin_sesditjen'],
        create: ['super_admin'],
        update: ['super_admin'],
        delete: ['super_admin'],
    },
    settings: {
        read: ['super_admin', 'admin_dirjen', 'admin_sesditjen'],
        update: ['super_admin'],
    },
    reports: {
        read: ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor'],
        create: ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor'],
        export: ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor'],
    },
    klasifikasi: {
        read: ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor', 'user'],
        create: ['super_admin'],
        update: ['super_admin'],
        delete: ['super_admin'],
    },
    storage_locations: {
        read: ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'auditor', 'user'],
        create: ['super_admin', 'admin_dirjen'],
        update: ['super_admin', 'admin_dirjen'],
        delete: ['super_admin'],
    },
};

// Role hierarchy - higher roles inherit permissions from lower roles
export const ROLE_HIERARCHY: Record<Role, number> = {
    'super_admin': 100,
    'admin_dirjen': 80,
    'admin_sesditjen': 60,
    'auditor': 40, // Read-only role
    'user': 20,
};

// Unit kerja access by role
export const UNIT_KERJA_ACCESS: Record<Role, string[] | '*'> = {
    'super_admin': '*', // Access to all units
    'admin_dirjen': ['dirjen-ptpp', 'dirjen-ptpp-*'], // Dirjen and sub-units
    'admin_sesditjen': ['sesditjen-*'], // Sesditjen sub-units
    'auditor': '*', // Read access to all (but auditor role restricts to read-only)
    'user': [], // Will be set based on user's unitKerjaId
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

    // Wildcard access
    if (accessConfig === '*') return true;

    // For regular users, they can only access their own unit
    if (role === 'user') {
        return userUnitKerjaId === targetUnitKerjaId;
    }

    // Check pattern matching
    return accessConfig.some(pattern => {
        if (pattern.endsWith('*')) {
            const prefix = pattern.slice(0, -1);
            return targetUnitKerjaId.startsWith(prefix);
        }
        return pattern === targetUnitKerjaId;
    });
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
 * Check if role is read-only (auditor)
 */
export function isReadOnlyRole(role: Role): boolean {
    return role === 'auditor' || role === 'user';
}
