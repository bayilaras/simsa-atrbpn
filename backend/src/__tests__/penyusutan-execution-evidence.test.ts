import { describe, expect, it, vi } from 'vitest';
vi.mock('../config/database', () => ({ db: {} }));
import { buildDestructionEvidenceSnapshot, parseDestructionEvidence } from '../services/penyusutan-execution-evidence';

const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const validInput = { beritaAcaraAttachmentId: ids[0], decisionAttachmentId: ids[1], executionProofAttachmentId: ids[2],
    performedAt: '2026-09-10T10:00:00+07:00', method: 'Pencacahan oleh petugas yang ditugaskan',
    copiesStatement: 'Seluruh salinan telah diinventarisasi dan pelaksanaannya dilampirkan.',
    witnesses: [{ userId: ids[4], authorityAttachmentId: ids[3] }, { userId: ids[5], authorityAttachmentId: ids[3] }] };
function validOptions() {
    return { input: parseDestructionEvidence(validInput), batch: { id: 'batch-1', unitKerjaId: 'u1', tanggalPersetujuan: '2026-09-09' },
        archiveIds: ['a1'], executorId: 'executor', now: new Date('2026-09-11T00:00:00Z'),
        attachments: ids.slice(0, 4).map(id => ({ id, entityType: 'arsip', entityId: 'a1', fileName: `${id}.pdf`,
            fileUrl: 'private/bukti.pdf', storageAccess: 'private', sha256: 'a'.repeat(64),
            malwareScanStatus: 'clean', integrityStatus: 'verified', lastFixityCheckAt: new Date('2026-09-10T00:00:00Z') })),
        witnesses: ids.slice(4).map(id => ({ id, name: 'Petugas uji', isActive: true, role: 'staff', unitKerjaId: 'u1' })) };
}
describe('controlled destruction evidence', () => {
    it('captures immutable evidence identity and hash without claiming automated deletion', () => {
        const { snapshot, sha256 } = buildDestructionEvidenceSnapshot(validOptions());
        expect(sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(snapshot.documents.beritaAcara.sha256).toBe('a'.repeat(64));
        expect(snapshot.witnesses).toHaveLength(2);
        expect(snapshot.verificationScope).toBe('controlled_evidence_and_internal_actor_checks');
    });
    it.each(['public', 'pending', 'mismatch', 'foreign', 'missing'])('rejects %s evidence', mode => {
        const options = validOptions();
        if (mode === 'public') options.attachments[0].storageAccess = 'public';
        if (mode === 'pending') options.attachments[0].malwareScanStatus = 'pending';
        if (mode === 'mismatch') options.attachments[0].integrityStatus = 'mismatch';
        if (mode === 'foreign') options.attachments[0].entityId = 'other-archive';
        if (mode === 'missing') options.attachments.shift();
        expect(() => buildDestructionEvidenceSnapshot(options)).toThrow(/lampiran arsip/);
    });
    it.each(['inactive', 'foreign', 'executor'])('rejects an %s witness', mode => {
        const options = validOptions();
        if (mode === 'inactive') options.witnesses[0].isActive = false;
        if (mode === 'foreign') options.witnesses[0].unitKerjaId = 'u2';
        if (mode === 'executor') options.executorId = ids[4];
        expect(() => buildDestructionEvidenceSnapshot(options)).toThrow(/Saksi harus/);
    });
    it.each(['2026-09-08T10:00:00Z', '2026-09-12T10:00:00Z'])('rejects a false execution time %s', performedAt => {
        const options = validOptions();
        options.input.performedAt = performedAt;
        expect(() => buildDestructionEvidenceSnapshot(options)).toThrow(/Waktu pelaksanaan/);
    });
    it('rejects duplicate witnesses and client-supplied verification flags', () => {
        expect(() => parseDestructionEvidence({ ...validInput, witnesses: [validInput.witnesses[0], validInput.witnesses[0]] })).toThrow();
        expect(() => parseDestructionEvidence({ ...validInput, verified: true })).toThrow();
    });
});
