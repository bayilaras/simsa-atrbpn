import { describe, expect, it } from 'vitest';
import { isFileReleased } from '../services/file-release-policy.js';

const clean = {
    storageAccess: 'private',
    sha256: 'a'.repeat(64),
    integrityStatus: 'baseline_recorded',
    malwareScanStatus: 'clean',
};

describe('file release policy', () => {
    it('releases only private, hashed bitstreams positively marked clean', () => {
        expect(isFileReleased(clean)).toBe(true);
    });

    it.each([
        [{ ...clean, malwareScanStatus: 'not_scanned' }, 'not scanned'],
        [{ ...clean, malwareScanStatus: 'infected' }, 'infected'],
        [{ ...clean, integrityStatus: 'mismatch' }, 'fixity mismatch'],
        [{ ...clean, sha256: null }, 'missing hash'],
        [{ ...clean, storageAccess: 'public' }, 'public storage'],
    ])('quarantines %s metadata (%s)', (metadata) => {
        expect(isFileReleased(metadata)).toBe(false);
    });
});
