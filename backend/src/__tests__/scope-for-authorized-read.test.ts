import { describe, expect, it } from 'vitest';
import { NO_RECORD_UNIT_ACCESS, scopeForAuthorizedRead } from '../utils/record-unit-scope';

const req = (user: any) => ({ user, query: {} }) as any;

describe('scopeForAuthorizedRead', () => {
    it('memakai scope pemilik untuk akses owner', () => {
        expect(scopeForAuthorizedRead(req({ role: 'admin_unit', unitKerjaId: 'dir_bppt' }), { allowed: true, via: 'owner', unitKerjaId: 'dir_bppt' })).toBe('dir_bppt');
        expect(scopeForAuthorizedRead(req({ role: 'super_admin', unitKerjaId: null }), { allowed: true, via: 'owner', unitKerjaId: 'dir_bppt' })).toBeNull();
    });
    it.each(['pengawas', 'peserta'] as const)('memuat tepat di unit rekaman untuk via %s', via => {
        expect(scopeForAuthorizedRead(req({ role: 'admin_unit', unitKerjaId: 'sesditjen' }), { allowed: true, via, unitKerjaId: 'dir_bppt' })).toBe('dir_bppt');
    });
    it('tidak pernah mengembalikan null untuk akses non-owner', () => {
        expect(scopeForAuthorizedRead(req({ role: 'super_admin' }), { allowed: true, via: 'peserta', unitKerjaId: null })).toBe(NO_RECORD_UNIT_ACCESS);
        expect(scopeForAuthorizedRead(req({ role: 'admin_unit', unitKerjaId: 'x' }), { allowed: true, via: 'pengawas', unitKerjaId: '  ' })).toBe(NO_RECORD_UNIT_ACCESS);
    });
    it('gagal tertutup bila tidak diizinkan', () => {
        expect(scopeForAuthorizedRead(req({ role: 'super_admin' }), { allowed: false, via: 'owner', unitKerjaId: 'dir_bppt' })).toBe(NO_RECORD_UNIT_ACCESS);
        expect(scopeForAuthorizedRead(req({ role: 'admin_unit', unitKerjaId: 'x' }), { allowed: true, via: null, unitKerjaId: 'x' })).toBe(NO_RECORD_UNIT_ACCESS);
    });
});
