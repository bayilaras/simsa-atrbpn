import { describe, expect, it } from 'vitest';
import {
    allowedSecurityClassifications,
    isAllowedForClassification,
    requiresExplicitAccessGrant,
} from '../services/record-access.service';
import { validateGrantExpiry } from '../services/record-access-grant.service';

describe('record classification access policy', () => {
    it('fails closed for secret records without a clearance model', () => {
        expect(isAllowedForClassification({ role: 'admin_dirjen' }, 'Rahasia')).toBe(false);
        expect(isAllowedForClassification({ role: 'super_admin' }, 'Sangat Rahasia')).toBe(true);
    });

    it('restricts limited records to administrators', () => {
        expect(isAllowedForClassification({ role: 'staff' }, 'Terbatas')).toBe(false);
        expect(isAllowedForClassification({ role: 'admin_sesditjen' }, 'Terbatas')).toBe(true);
    });

    it('allows ordinary/open records after unit authorization', () => {
        expect(isAllowedForClassification({ role: 'staff' }, 'Biasa/Terbuka')).toBe(true);
        expect(isAllowedForClassification({ role: 'staff' }, 'Sangat Segera')).toBe(true);
    });

    it('fails closed for unrecognised classifications', () => {
        expect(isAllowedForClassification({ role: 'staff' }, 'internal-khusus')).toBe(false);
        expect(isAllowedForClassification({ role: 'super_admin' }, 'internal-khusus')).toBe(false);
        expect(allowedSecurityClassifications({ role: 'super_admin' })).toEqual([
            'biasa',
            'terbatas',
            'rahasia',
            'sangat_rahasia',
        ]);
    });

    it('requires an explicit grant for every controlled classification', () => {
        expect(requiresExplicitAccessGrant('Terbatas')).toBe(true);
        expect(requiresExplicitAccessGrant('RAHASIA')).toBe(true);
        expect(requiresExplicitAccessGrant('Sangat Rahasia')).toBe(true);
        expect(requiresExplicitAccessGrant('Biasa/Terbuka')).toBe(false);
        expect(requiresExplicitAccessGrant('unknown')).toBe(false);
    });

    it('limits approved access to a bounded period', () => {
        const now = new Date('2026-08-25T00:00:00.000Z');
        expect(validateGrantExpiry('2026-08-25T01:00:00.000Z', now))
            .toEqual(new Date('2026-08-25T01:00:00.000Z'));
        expect(() => validateGrantExpiry('2026-08-25T00:10:00.000Z', now))
            .toThrow(/15 menit/);
        expect(() => validateGrantExpiry('2026-09-25T00:00:01.000Z', now))
            .toThrow(/30 hari/);
    });
});
