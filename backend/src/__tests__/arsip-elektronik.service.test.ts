import { beforeEach, describe, expect, it, vi } from 'vitest';

const resultQueue: any[] = [];
const writtenValues: any[] = [];
let transactionCommits = 0;
let transactionRollbacks = 0;

const mocks = vi.hoisted(() => ({
    audit: vi.fn(),
    verifyIntegrity: vi.fn(),
    checkAccess: vi.fn(),
}));

const chain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const value = resultQueue.shift() ?? [];
            return (resolve: any) => resolve(value);
        }
        return (value: any) => { if (prop === 'values') writtenValues.push(value); return chain; };
    },
});

const mockDb: any = {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    transaction: async (operation: any) => {
        try {
            const result = await operation(mockDb);
            transactionCommits += 1;
            return result;
        } catch (error) {
            transactionRollbacks += 1;
            throw error;
        }
    },
};

vi.mock('../config/database.js', () => ({ db: mockDb }));
vi.mock('../services/audit-log.service.js', () => ({
    default: { logActionOrThrow: mocks.audit },
}));
vi.mock('../services/file-attachment.service.js', () => ({
    fileAttachmentService: { verifyIntegrity: mocks.verifyIntegrity },
}));
vi.mock('../services/record-access.service.js', () => ({ recordAccessService: { check: mocks.checkAccess } }));

const { arsipElektronikService } = await import('../services/arsip-elektronik.service.js');

const pendingRecord = {
    id: 'electronic-1',
    arsipId: 'archive-1',
    fileAttachmentId: 'attachment-1',
    statusVerifikasi: 'pending',
    immutable: false,
    sourceType: 'born_digital',
    scanCategory: 'born_digital',
    resolusiDPI: null,
    colorDepth: null,
    qcStatus: 'passed',
};

const controlledAttachment = {
    id: 'attachment-1',
    entityType: 'arsip',
    entityId: 'archive-1',
    storageAccess: 'private',
    malwareScanStatus: 'clean',
    integrityStatus: 'baseline_recorded',
};
const preservationActor = { id: 'reviewer-1', email: 'reviewer@example.test', isActive: true, role: 'super_admin' };

describe('ArsipElektronikService critical verification', () => {
    beforeEach(() => {
        resultQueue.length = 0;
        writtenValues.length = 0;
        transactionCommits = 0;
        transactionRollbacks = 0;
        mocks.audit.mockReset();
        mocks.audit.mockResolvedValue(undefined);
        mocks.verifyIntegrity.mockReset();
        mocks.checkAccess.mockReset();
        mocks.checkAccess.mockResolvedValue({ allowed: true, mutable: true, grantId: null, grantExpiresAt: null });
        mocks.verifyIntegrity.mockResolvedValue({
            attachment: { ...controlledAttachment, integrityStatus: 'verified' },
            expectedHash: 'a'.repeat(64),
            actualHash: 'a'.repeat(64),
            matches: true,
        });
    });

    it('releases only a private, malware-clean attachment whose fixity is verified', async () => {
        resultQueue.push(
            [pendingRecord],
            [controlledAttachment],
            [{ ...pendingRecord, statusVerifikasi: 'verified', immutable: true }],
        );

        const result = await arsipElektronikService.verify(
            pendingRecord.id,
            'reviewer-1',
            'verified',
            'Bitstream sesuai',
            { userId: 'reviewer-1' },
        );

        expect(result).toMatchObject({ statusVerifikasi: 'verified', immutable: true });
        expect(mocks.verifyIntegrity).toHaveBeenCalledWith('attachment-1', mockDb);
        expect(mocks.audit).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'status_change',
                entityType: 'arsip_elektronik',
                entityId: 'electronic-1',
            }),
            mockDb,
        );
        expect(transactionCommits).toBe(1);
        expect(transactionRollbacks).toBe(0);
    });

    it('fails closed when the attachment is not private', async () => {
        resultQueue.push([pendingRecord], [{ ...controlledAttachment, storageAccess: 'public' }]);

        await expect(arsipElektronikService.verify(
            pendingRecord.id,
            'reviewer-1',
            'verified',
            undefined,
            { userId: 'reviewer-1' },
        )).rejects.toThrow(/private/i);

        expect(mocks.verifyIntegrity).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
        expect(transactionRollbacks).toBe(1);
    });

    it('fails closed until malware scanning reports clean', async () => {
        resultQueue.push([pendingRecord], [{ ...controlledAttachment, malwareScanStatus: 'pending' }]);

        await expect(arsipElektronikService.verify(
            pendingRecord.id,
            'reviewer-1',
            'verified',
            undefined,
            { userId: 'reviewer-1' },
        )).rejects.toThrow(/malware/i);

        expect(mocks.verifyIntegrity).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
        expect(transactionRollbacks).toBe(1);
    });

    it('does not release a bitstream whose integrity result is not verified', async () => {
        resultQueue.push([pendingRecord], [controlledAttachment]);
        mocks.verifyIntegrity.mockResolvedValueOnce({
            attachment: { ...controlledAttachment, integrityStatus: 'mismatch' },
            expectedHash: 'a'.repeat(64),
            actualHash: 'b'.repeat(64),
            matches: false,
        });

        await expect(arsipElektronikService.verify(
            pendingRecord.id,
            'reviewer-1',
            'verified',
            undefined,
            { userId: 'reviewer-1' },
        )).rejects.toThrow(/hash bitstream/i);

        expect(mocks.audit).not.toHaveBeenCalled();
        expect(transactionRollbacks).toBe(1);
    });

    it('rolls back the verification decision when critical audit storage fails', async () => {
        resultQueue.push(
            [pendingRecord],
            [controlledAttachment],
            [{ ...pendingRecord, statusVerifikasi: 'verified', immutable: true }],
        );
        mocks.audit.mockRejectedValueOnce(new Error('audit unavailable'));

        await expect(arsipElektronikService.verify(
            pendingRecord.id,
            'reviewer-1',
            'verified',
            undefined,
            { userId: 'reviewer-1' },
        )).rejects.toThrow('audit unavailable');

        expect(transactionCommits).toBe(0);
        expect(transactionRollbacks).toBe(1);
    });

    it('refuses a conversion completion log without controlled output and supporting evidence', async () => {
        resultQueue.push([pendingRecord], [{ id: 'log-1' }]);
        await expect(arsipElektronikService.addPreservationAction({ arsipElektronikId: pendingRecord.id,
            action: 'conversion', details: 'Converted to PDF/A', performedBy: 'reviewer-1' }, { userId: 'reviewer-1' }))
            .rejects.toThrow(/bukti.*hasil|hasil.*bukti/i);
    });

    it('labels a real integrity reread separately from an external preservation activity', async () => {
        resultQueue.push([pendingRecord], [{ id: 'archive-1', disposalStatus: 'active', legalHold: false }],
            [preservationActor], [pendingRecord], [{ ...controlledAttachment, sha256: 'a'.repeat(64) }], [{ id: 'log-1' }]);
        await arsipElektronikService.addPreservationAction({ arsipElektronikId: pendingRecord.id,
            action: 'integrity_check', performedBy: 'reviewer-1' }, { userId: 'reviewer-1' });
        expect(writtenValues.at(-1)).toMatchObject({ recordingMode: 'system_integrity_check',
            evidenceSnapshot: expect.objectContaining({ result: 'match', algorithm: 'SHA-256' }) });
    });

    function externalActivityFixture() {
        const ids = Array.from({ length: 3 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
        const record = { ...pendingRecord, fileAttachmentId: ids[0] };
        const attachments = ids.map(id => ({ ...controlledAttachment, id, integrityStatus: 'verified', sha256: 'a'.repeat(64) }));
        mocks.verifyIntegrity.mockImplementation(async id => ({ attachment: attachments.find(item => item.id === id),
            expectedHash: 'a'.repeat(64), actualHash: 'a'.repeat(64), matches: true }));
        const input = { arsipElektronikId: record.id, performedBy: 'reviewer-1', action: 'conversion',
            outputAttachmentId: ids[1], evidenceAttachmentId: ids[2], toolName: 'Perangkat uji', toolVersion: '1.0',
            activityAt: '2020-01-01T00:00:00Z' };
        return { record, attachments, input };
    }
    it('records external evidence with three readback baselines without claiming a system conversion', async () => {
        const { record, attachments, input } = externalActivityFixture();
        resultQueue.push([record], [{ id: 'archive-1', disposalStatus: 'active', legalHold: false }], [preservationActor], [record], attachments, [{ id: 'log-1' }]);
        await arsipElektronikService.addPreservationAction(input, { userId: 'reviewer-1' });
        expect(writtenValues.at(-1)).toMatchObject({ recordingMode: 'external_activity_recorded',
            evidenceSnapshot: { result: 'evidence_recorded', checks: expect.arrayContaining([
                expect.objectContaining({ attachmentId: input.outputAttachmentId, matches: true }),
                expect.objectContaining({ attachmentId: input.evidenceAttachmentId, matches: true }),
            ]) } });
        expect(mocks.verifyIntegrity).toHaveBeenCalledTimes(3);
    });
    it('persists mismatch and audit but refuses a successful external activity record', async () => {
        const { record, attachments, input } = externalActivityFixture();
        resultQueue.push([record], [{ id: 'archive-1', disposalStatus: 'active', legalHold: false }], [preservationActor], [record], attachments);
        mocks.verifyIntegrity.mockResolvedValueOnce({ attachment: attachments[0], expectedHash: 'a'.repeat(64), actualHash: 'b'.repeat(64), matches: false });
        await expect(arsipElektronikService.addPreservationAction(input, { userId: 'reviewer-1' })).rejects.toThrow(/Integritas.*tidak cocok/);
        expect(writtenValues).toEqual([]);
        expect(transactionCommits).toBe(1);
        expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'verify_integrity',
            changes: expect.objectContaining({ operation: 'external_preservation_evidence_rejected' }) }), mockDb);
    });
    it('preserves legal hold and rejects a foreign output before reading bytes', async () => {
        const { record, attachments, input } = externalActivityFixture();
        resultQueue.push([record], [{ id: 'archive-1', disposalStatus: 'active', legalHold: true }]);
        await expect(arsipElektronikService.addPreservationAction(input, { userId: 'reviewer-1' })).rejects.toThrow(/ditahan/);
        resultQueue.push([record], [{ id: 'archive-1', disposalStatus: 'active', legalHold: false }], [preservationActor], [record],
            attachments.map((item, index) => index === 1 ? { ...item, entityId: 'foreign' } : item));
        await expect(arsipElektronikService.addPreservationAction(input, { userId: 'reviewer-1' })).rejects.toThrow(/arsip yang sama/);
        expect(mocks.verifyIntegrity).not.toHaveBeenCalled();
    });
    it('does not retain a successful external activity when its critical audit fails', async () => {
        const { record, attachments, input } = externalActivityFixture();
        resultQueue.push([record], [{ id: 'archive-1', disposalStatus: 'active', legalHold: false }], [preservationActor], [record], attachments, [{ id: 'log-1' }]);
        mocks.audit.mockRejectedValueOnce(new Error('audit unavailable'));
        await expect(arsipElektronikService.addPreservationAction(input, { userId: 'reviewer-1' })).rejects.toThrow('audit unavailable');
        expect(transactionCommits).toBe(0);
    });
});
