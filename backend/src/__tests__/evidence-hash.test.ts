import { describe, expect, it } from 'vitest';
import { hashEvidenceSnapshot } from '../utils/evidence-hash.js';

describe('persisted JSON evidence seals', () => {
    it('survives key reordering performed by JSONB storage', () => {
        const captured = { schemaVersion: 1, documents: { source: { name: 'a.pdf', sha256: 'a'.repeat(64) } }, witnesses: ['first', 'second'] };
        const persisted = { witnesses: ['first', 'second'], documents: { source: { sha256: 'a'.repeat(64), name: 'a.pdf' } }, schemaVersion: 1 };
        expect(hashEvidenceSnapshot(captured)).toBe(hashEvidenceSnapshot(persisted));
    });

    it('seals the same JSON value that is actually persisted, including omitted optional fields', () => {
        const snapshot = { optional: undefined, checkedAt: new Date('2026-09-11T00:00:00Z'), items: [{ name: 'a', absent: undefined }] };
        expect(hashEvidenceSnapshot(snapshot)).toBe(hashEvidenceSnapshot(JSON.parse(JSON.stringify(snapshot))));
    });

    it('detects changed content and changed array order', () => {
        expect(hashEvidenceSnapshot({ files: ['a', 'b'] })).not.toBe(hashEvidenceSnapshot({ files: ['b', 'a'] }));
        expect(hashEvidenceSnapshot({ hash: 'a' })).not.toBe(hashEvidenceSnapshot({ hash: 'b' }));
    });
});
