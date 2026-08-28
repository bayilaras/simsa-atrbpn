import { beforeEach, describe, expect, it, vi } from 'vitest';

const resultQueue: any[] = [];
let transactionCommits = 0;
let transactionRollbacks = 0;

const mocks = vi.hoisted(() => ({
    audit: vi.fn(),
    verifyIntegrity: vi.fn(),
}));

const chain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const value = resultQueue.shift() ?? [];
            return (resolve: any) => resolve(value);
        }
        return () => chain;
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

describe('ArsipElektronikService critical verification', () => {
    beforeEach(() => {
        resultQueue.length = 0;
        transactionCommits = 0;
        transactionRollbacks = 0;
        mocks.audit.mockReset();
        mocks.audit.mockResolvedValue(undefined);
        mocks.verifyIntegrity.mockReset();
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
});
