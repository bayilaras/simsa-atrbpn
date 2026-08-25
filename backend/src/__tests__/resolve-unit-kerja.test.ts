import { describe, it, expect } from 'vitest';
import { resolveUnitKerjaId } from '../utils/resolve-unit-kerja';
import type { AuthRequest } from '../middlewares/auth.middleware';

function createMockReq(overrides: {
    role?: string;
    unitKerjaId?: string | null;
    queryUnitKerjaId?: string;
} = {}): AuthRequest {
    return {
        user: {
            id: 'test-id',
            email: 'test@atrbpn.go.id',
            name: 'Test User',
            role: overrides.role || 'user',
            unitKerjaId: overrides.unitKerjaId ?? null,
        },
        query: {
            ...(overrides.queryUnitKerjaId ? { unitKerjaId: overrides.queryUnitKerjaId } : {}),
        },
    } as unknown as AuthRequest;
}

describe('resolveUnitKerjaId', () => {
    describe('super_admin', () => {
        it('should return the requested unitKerjaId if provided via query', () => {
            const req = createMockReq({ role: 'super_admin', queryUnitKerjaId: 'ditjen' });
            expect(resolveUnitKerjaId(req)).toBe('ditjen');
        });

        it('should return null when no unitKerjaId requested (sees all data)', () => {
            const req = createMockReq({ role: 'super_admin' });
            expect(resolveUnitKerjaId(req)).toBeNull();
        });

        it('should return any requested unit (no restrictions)', () => {
            const req = createMockReq({ role: 'super_admin', queryUnitKerjaId: 'bagian_keuangan' });
            expect(resolveUnitKerjaId(req)).toBe('bagian_keuangan');
        });
    });

    describe('admin_dirjen', () => {
        it('should always return ditjen regardless of query', () => {
            const req = createMockReq({ role: 'admin_dirjen', unitKerjaId: 'ditjen' });
            expect(resolveUnitKerjaId(req)).toBe('ditjen');
        });

        it('should enforce ditjen even when another unit is requested', () => {
            const req = createMockReq({ role: 'admin_dirjen', unitKerjaId: 'ditjen', queryUnitKerjaId: 'sesditjen' });
            expect(resolveUnitKerjaId(req)).toBe('ditjen');
        });
    });

    describe('admin_sesditjen', () => {
        it('should always return sesditjen regardless of query', () => {
            const req = createMockReq({ role: 'admin_sesditjen', unitKerjaId: 'sesditjen' });
            expect(resolveUnitKerjaId(req)).toBe('sesditjen');
        });

        it('should enforce sesditjen even when another unit is requested', () => {
            const req = createMockReq({ role: 'admin_sesditjen', unitKerjaId: 'sesditjen', queryUnitKerjaId: 'ditjen' });
            expect(resolveUnitKerjaId(req)).toBe('sesditjen');
        });
    });

    describe('staff', () => {
        it('should return the user assigned unit kerja', () => {
            const req = createMockReq({ role: 'staff', unitKerjaId: 'bagian_keuangan' });
            expect(resolveUnitKerjaId(req)).toBe('bagian_keuangan');
        });

        it('should enforce own unit even when another unit is requested', () => {
            const req = createMockReq({ role: 'staff', unitKerjaId: 'bagian_keuangan', queryUnitKerjaId: 'ditjen' });
            expect(resolveUnitKerjaId(req)).toBe('bagian_keuangan');
        });

        it('should return null if staff has no unitKerjaId', () => {
            const req = createMockReq({ role: 'staff', unitKerjaId: null });
            expect(resolveUnitKerjaId(req)).toBeNull();
        });
    });

    describe('auditor', () => {
        it('should use the assigned audit-mandate unit', () => {
            const req = createMockReq({ role: 'auditor', unitKerjaId: 'sesditjen' });
            expect(resolveUnitKerjaId(req)).toBe('sesditjen');
        });

        it('should ignore a requested unit outside that mandate', () => {
            const req = createMockReq({ role: 'auditor', unitKerjaId: 'sesditjen', queryUnitKerjaId: 'ditjen' });
            expect(resolveUnitKerjaId(req)).toBe('sesditjen');
        });
    });

    describe('user (default/no access)', () => {
        it('should return the user unitKerjaId (even though user has no read permissions)', () => {
            const req = createMockReq({ role: 'user', unitKerjaId: 'ditjen' });
            expect(resolveUnitKerjaId(req)).toBe('ditjen');
        });

        it('should return null when user has no unitKerjaId', () => {
            const req = createMockReq({ role: 'user', unitKerjaId: null });
            expect(resolveUnitKerjaId(req)).toBeNull();
        });
    });
});
