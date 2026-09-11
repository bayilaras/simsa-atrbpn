import { describe, expect, it } from 'vitest';
import { isFileReleased, quarantinedFileScanState } from '../services/file-release-policy.js';

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

describe('quarantine recovery guidance', () => {
    it.each(['not_scanned', 'scanning:1:1800000000', 'retry:2:1800000030'])('offers recovery only for a pending %s queue state', (malwareScanStatus) => {
        expect(quarantinedFileScanState({ ...clean, malwareScanStatus })).toBe('pending');
        expect(isFileReleased({ ...clean, malwareScanStatus })).toBe(false);
    });
    it.each([
        { ...clean, malwareScanStatus: 'infected' },
        { ...clean, malwareScanStatus: 'scan_error' },
        { ...clean, integrityStatus: 'mismatch' },
        { ...clean, malwareScanStatus: 'not_scanned', sha256: null },
        { ...clean, malwareScanStatus: 'not_scanned', storageAccess: 'public' },
    ])('does not describe terminal or incomplete ingest as waiting for a scan', (metadata) => {
        expect(quarantinedFileScanState(metadata)).toBe('blocked');
    });
    it('does not guess pending for missing registration or unknown status', () => {
        expect(quarantinedFileScanState(null)).toBe('unavailable');
        expect(quarantinedFileScanState({ ...clean, malwareScanStatus: 'unknown' })).toBe('unavailable');
    });
});
