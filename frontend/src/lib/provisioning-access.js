import { resolveEffectiveUnitKerjaId } from './unit-kerja-scope'

export const PROVISIONED_ROLES = Object.freeze([
    'super_admin',
    'admin_dirjen',
    'admin_sesditjen',
    'staff',
    'auditor',
])

export const REPORT_EXPORT_ROLES = Object.freeze([
    'super_admin',
    'admin_dirjen',
    'admin_sesditjen',
    'auditor',
])

export function isProvisionedRole(role) {
    return typeof role === 'string' && PROVISIONED_ROLES.includes(role)
}

export function hasProvisionedAccess(user) {
    if (!isProvisionedRole(user?.role)) return false
    if (user.role === 'super_admin') return true

    const effectiveUnitKerjaId = resolveEffectiveUnitKerjaId(user)
    return typeof effectiveUnitKerjaId === 'string' && effectiveUnitKerjaId.trim().length > 0
}

export function canExportReports(role) {
    return typeof role === 'string' && REPORT_EXPORT_ROLES.includes(role)
}
