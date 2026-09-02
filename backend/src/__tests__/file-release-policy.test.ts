import { describe, expect, it } from 'vitest';
import { isFileReleased } from '../services/file-release-policy.js';

const clean = {
    storageAccess: 'private',
    sha256: 'a'.repeat(64),
    integrityStatus: 'verified',
    malwareScanStatus: 'clean',
};

describe('file release policy', () => {
    it('releases only private, hashed bitstreams positively marked clean', () => {
        expect(isFileReleased(clean)).toBe(true);
    });

    it.each([
        [{ ...clean, malwareScanStatus: 'not_scanned' }, 'not scanned'],
        [{ ...clean, malwareScanStatus: 'scanning:1:1800000000' }, 'scan in progress'],
        [{ ...clean, malwareScanStatus: 'retry:1:1800000030' }, 'scan retry'],
        [{ ...clean, malwareScanStatus: 'scan_error' }, 'scan failed'],
        [{ ...clean, malwareScanStatus: 'infected' }, 'infected'],
        [{ ...clean, integrityStatus: 'baseline_recorded' }, 'baseline not verified'],
        [{ ...clean, integrityStatus: 'mismatch' }, 'fixity mismatch'],
        [{ ...clean, sha256: null }, 'missing hash'],
        [{ ...clean, storageAccess: 'public' }, 'public storage'],
    ])('quarantines %s metadata (%s)', (metadata) => {
        expect(isFileReleased(metadata)).toBe(false);
    });
});
