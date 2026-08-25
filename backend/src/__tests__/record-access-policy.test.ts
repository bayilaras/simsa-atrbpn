import { describe, expect, it } from 'vitest';
import { isAllowedForClassification } from '../services/record-access.service';

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
    });
});
