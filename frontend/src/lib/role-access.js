import { resolveEffectiveUnitKerjaId } from './unit-kerja-scope'

export const ASSIGNABLE_ROLE_OPTIONS = Object.freeze([
    { value: 'super_admin', label: 'Super Admin' },
    { value: 'admin_unit', label: 'Admin Unit Kerja' },
])

export const UNIT_ADMIN_ROLES = Object.freeze(['admin_unit', 'admin_dirjen', 'admin_sesditjen'])

export function canManageUnit(user, requestedUnitKerjaId = '') {
    if (user?.role === 'super_admin') return true
    if (!UNIT_ADMIN_ROLES.includes(user?.role)) return false
    const ownUnit = resolveEffectiveUnitKerjaId(user)
    if (typeof ownUnit !== 'string' || !ownUnit.trim()) return false
    return !requestedUnitKerjaId || requestedUnitKerjaId === ownUnit
}

export function managedUserRoleError(role, unitKerjaId, originalRole = '') {
    if (!ASSIGNABLE_ROLE_OPTIONS.some(option => option.value === role) && (!originalRole || role !== originalRole)) {
        return 'Pilih Super Admin atau Admin Unit Kerja.'
    }
    if (role === 'admin_unit' && (typeof unitKerjaId !== 'string' || !unitKerjaId.trim())) {
        return 'Unit kerja wajib dipilih untuk Admin Unit Kerja.'
    }
    return ''
}
