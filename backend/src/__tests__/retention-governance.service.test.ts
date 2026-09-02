import { describe, expect, it } from 'vitest';
import {
    canonicalSha256,
    derivePermanentTransferStatus,
    isEligiblePermanentTransferAttachment,
    validateItemOutcomeHierarchy,
} from '../services/retention-governance.service';

describe('retention governance deterministic helpers', () => {
    it('hashes object keys canonically for immutable decision snapshots', () => {
        expect(canonicalSha256({ b: 2, a: { y: 2, x: 1 } }))
            .toBe(canonicalSha256({ a: { x: 1, y: 2 }, b: 2 }));
        expect(canonicalSha256({ a: 1 })).not.toBe(canonicalSha256({ a: 2 }));
    });

    it('derives permanent transfer status only from append-only events', () => {
        expect(derivePermanentTransferStatus([])).toBe('draft');
        expect(derivePermanentTransferStatus(['handover'])).toBe('handed_over');
        expect(derivePermanentTransferStatus(['handover', 'acknowledgement']))
            .toBe('acknowledged');
        expect(derivePermanentTransferStatus([], ['pending'])).toBe('cancellation_pending');
        expect(derivePermanentTransferStatus([], ['rejected'])).toBe('draft');
        expect(derivePermanentTransferStatus([], ['approved'])).toBe('cancelled');
    });

    it('allows Permanen exceptions in a Musnah series but blocks downgrades', () => {
        expect(() => validateItemOutcomeHierarchy('musnah', [
            { outcome: 'permanen' },
        ])).not.toThrow();
        expect(() => validateItemOutcomeHierarchy('permanen', [
            { outcome: 'musnah' },
        ])).toThrow(/tidak dapat diturunkan/i);
    });

    it('accepts only manifest-bound clean private attachments with verified fixity', () => {
        const metadata = {
            entityType: 'arsip',
            entityId: 'archive-1',
            storageAccess: 'private',
            sha256: 'a'.repeat(64),
            integrityStatus: 'verified',
            malwareScanStatus: 'clean',
            lastFixityCheckAt: new Date(),
            fileUrl: 'https://example.private.blob.vercel-storage.com/archive.pdf',
        };
        expect(isEligiblePermanentTransferAttachment(
            metadata,
            'a'.repeat(64),
            ['archive-1'],
        )).toBe(true);
        expect(isEligiblePermanentTransferAttachment(
            { ...metadata, malwareScanStatus: 'not_scanned' },
            'a'.repeat(64),
            ['archive-1'],
        )).toBe(false);
        expect(isEligiblePermanentTransferAttachment(
            metadata,
            'b'.repeat(64),
            ['archive-1'],
        )).toBe(false);
        expect(isEligiblePermanentTransferAttachment(
            metadata,
            'a'.repeat(64),
            ['archive-2'],
        )).toBe(false);
    });
});
