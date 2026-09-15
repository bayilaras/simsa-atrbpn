import { describe, expect, it } from 'vitest';
import { isAttachmentAvailable, isFileReleased, quarantinedFileScanState } from '../services/file-release-policy.js';

const clean = {
    storageAccess: 'private',
    sha256: 'a'.repeat(64),
    integrityStatus: 'verified',
    malwareScanStatus: 'clean',
};

describe('file release policy', () => {
    it.each(['surat_masuk', 'surat_keluar'])('opens registered private %s attachments without inspection evidence', entityType => {
        for (const malwareScanStatus of ['not_required', 'not_scanned', 'scanning:1:1800000000', 'retry:1:1800000030', 'scan_error', 'infected']) {
            const metadata = { entityType, fileUrl: 'https://store.private.blob.vercel-storage.com/surat/document.pdf', storageAccess: 'private', sha256: null, integrityStatus: 'unverified', malwareScanStatus };
            expect(isAttachmentAvailable(metadata)).toBe(true);
            expect(isFileReleased(metadata)).toBe(false);
            expect(isAttachmentAvailable({ ...metadata, storageAccess: 'public' })).toBe(false);
        }
    });

    it.each(['gs://private/record.pdf', 'https://store.public.blob.vercel-storage.com/record.pdf',
        'https://store.private.blob.vercel-storage.com.attacker.test/record.pdf', 'https://store.private.blob.vercel-storage.com/record.pdf?token=x', null])('does not exempt an unconfirmed or GCS locator: %s', fileUrl => {
        expect(isAttachmentAvailable({ ...clean, entityType: 'surat_masuk', fileUrl, sha256: null, malwareScanStatus: 'not_scanned' })).toBe(false);
    });

    it.each(['arsip', 'regulatory_rule_set', undefined])('retains inspection requirements for %s evidence', entityType => {
        expect(isAttachmentAvailable({ ...clean, entityType })).toBe(true);
        expect(isAttachmentAvailable({ ...clean, entityType, sha256: null, malwareScanStatus: 'not_scanned' })).toBe(false);
    });

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
