// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ASSIGNABLE_ROLE_OPTIONS, canManageUnit, managedUserRoleError } from './role-access'
import { hasProvisionedAccess, canExportReports } from './provisioning-access'
import { resolveEffectiveUnitKerjaId, resolveManagedUserUnitKerjaId } from './unit-kerja-scope'

describe('two-role access and legacy compatibility', () => {
    it('offers only the two canonical assignments and requires a unit administrator assignment', () => {
        expect(ASSIGNABLE_ROLE_OPTIONS.map(role => role.value)).toEqual(['super_admin', 'admin_unit'])
        expect(managedUserRoleError('admin_unit', '')).toMatch(/Unit kerja wajib/)
        expect(managedUserRoleError('admin_unit', '   ')).toMatch(/Unit kerja wajib/)
        expect(managedUserRoleError('admin_unit', 'unit-a')).toBe('')
        expect(managedUserRoleError('', '')).toMatch(/Pilih Super Admin/)
        expect(managedUserRoleError('staff', 'unit-a')).toMatch(/Pilih Super Admin/)
        expect(managedUserRoleError('staff', 'unit-a', 'staff')).toBe('')
        expect(resolveManagedUserUnitKerjaId('super_admin', 'unit-a')).toBe('')
    })

    it('lets a unit admin manage and export only within its assigned unit', () => {
        const user = { role: 'admin_unit', unitKerjaId: 'unit-a' }
        expect(hasProvisionedAccess(user)).toBe(true)
        expect(canManageUnit(user)).toBe(true)
        expect(canManageUnit(user, 'unit-a')).toBe(true)
        expect(canManageUnit(user, 'unit-b')).toBe(false)
        expect(resolveEffectiveUnitKerjaId(user, 'unit-b')).toBe('unit-a')
        expect(canExportReports(user.role)).toBe(true)
    })

    it.each([null, '', '   '])('fails closed for a unit admin without a usable assignment: %s', unitKerjaId => {
        expect(hasProvisionedAccess({ role: 'admin_unit', unitKerjaId })).toBe(false)
        expect(canManageUnit({ role: 'admin_unit', unitKerjaId })).toBe(false)
    })

    it('gives super admin global operational scope', () => {
        const user = { role: 'super_admin', unitKerjaId: null }
        expect(hasProvisionedAccess(user)).toBe(true)
        expect(canManageUnit(user, 'unit-a')).toBe(true)
        expect(canManageUnit(user, 'unit-b')).toBe(true)
        expect(resolveEffectiveUnitKerjaId(user, 'unit-b')).toBe('unit-b')
    })

    it.each([['admin_dirjen', 'ditjen'], ['admin_sesditjen', 'sesditjen']])('retains %s fixed scope without trusting a stale assignment', (role, fixedUnit) => {
        const user = { role, unitKerjaId: 'unit-other' }
        expect(canManageUnit(user, fixedUnit)).toBe(true)
        expect(canManageUnit(user, 'unit-other')).toBe(false)
        expect(resolveEffectiveUnitKerjaId(user, 'unit-other')).toBe(fixedUnit)
    })

    it.each(['staff', 'auditor'])('preserves %s read access without elevating it to manager', role => {
        const user = { role, unitKerjaId: 'unit-a' }
        expect(hasProvisionedAccess(user)).toBe(true)
        expect(canManageUnit(user, 'unit-a')).toBe(false)
    })
})
