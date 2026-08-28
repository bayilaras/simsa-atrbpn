import { describe, expect, it } from 'vitest';
import { resolveRequiredUnitKerjaId } from './use-required-unit-kerja-scope';
import { resolveManagedUserUnitKerjaId } from '@/lib/unit-kerja-scope';

describe('required unit kerja scope', () => {
    it('canonicalizes managed super admins to a cross-unit empty assignment', () => {
        expect(resolveManagedUserUnitKerjaId('super_admin', 'legacy-unit')).toBe('');
        expect(resolveManagedUserUnitKerjaId('admin_dirjen', 'legacy-unit')).toBe('ditjen');
        expect(resolveManagedUserUnitKerjaId('staff', 'unit-a')).toBe('unit-a');
    });

    it('fails closed for a super admin until a concrete unit is selected', () => {
        const user = { role: 'super_admin', unitKerjaId: null };
        expect(resolveRequiredUnitKerjaId(user)).toBe('');
        expect(resolveRequiredUnitKerjaId(user, 'unit-a')).toBe('unit-a');
    });

    it('uses the authenticated mandate for scoped users', () => {
        expect(resolveRequiredUnitKerjaId({ role: 'admin_dirjen', unitKerjaId: 'unit-b' }, 'unit-a'))
            .toBe('ditjen');
        expect(resolveRequiredUnitKerjaId({ role: 'admin_sesditjen', unitKerjaId: null }, 'unit-a'))
            .toBe('sesditjen');
    });

    it('freezes super-admin edit workflows to the unit stored on the record', () => {
        const user = { role: 'super_admin', unitKerjaId: null };
        expect(resolveRequiredUnitKerjaId(user, 'unit-other', 'unit-record'))
            .toBe('unit-record');
    });
});
