import { beforeEach, describe, expect, it, vi } from 'vitest';

const resultQueue: any[] = [];
function enqueue(...results: any[]) {
    resultQueue.push(...results);
}

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const value = resultQueue.shift() ?? [];
            return (resolve: any) => resolve(value);
        }
        return (..._args: any[]) => mockChain;
    },
});

const mockDb: any = {
    select: vi.fn(() => mockChain),
    insert: vi.fn(() => mockChain),
    update: vi.fn(() => mockChain),
    delete: vi.fn(() => mockChain),
    transaction: vi.fn(async (callback: any) => callback(mockDb)),
};

vi.mock('../config/database.js', () => ({ db: mockDb }));
vi.mock('../services/email.service.js', () => ({
    emailService: { sendApprovalNotification: vi.fn() },
}));
vi.mock('../utils/logger.js', () => ({
    createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

const { ApprovalService } = await import('../services/approval.service.js');
const { SignatureService } = await import('../services/signature.service.js');

const staff = {
    id: 'staff-1',
    role: 'staff',
    unitKerjaId: 'unit-a',
};
const adminDirjen = {
    id: 'admin-1',
    role: 'admin_dirjen',
    unitKerjaId: null,
};
const unitAdmin = {
    id: 'super-unit-a',
    role: 'super_admin',
    unitKerjaId: 'unit-a',
};

describe('approval and signature service security', () => {
    let approvalService: InstanceType<typeof ApprovalService>;
    let signatureService: InstanceType<typeof SignatureService>;

    beforeEach(() => {
        vi.clearAllMocks();
        resultQueue.length = 0;
        approvalService = new ApprovalService();
        signatureService = new SignatureService();
    });

    it('fails closed when submit cannot find the surat in the caller unit scope', async () => {
        enqueue([]);

        await expect(approvalService.submit(
            'surat-foreign',
            staff,
            'admin-2',
            'unit-a',
        )).rejects.toThrow('Surat keluar tidak ditemukan');

        expect(mockDb.insert).not.toHaveBeenCalled();
        expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('allows only the source owner to submit a surat', async () => {
        enqueue([{
            id: 'surat-1',
            unitKerjaId: 'unit-a',
            createdBy: 'different-owner',
            approvalStatus: 'draft',
            isArchived: false,
            isDeleted: false,
            isSigned: false,
        }]);

        await expect(approvalService.submit(
            'surat-1',
            unitAdmin,
            'admin-2',
            'unit-a',
        )).rejects.toThrow('Hanya pembuat surat');

        expect(mockDb.insert).not.toHaveBeenCalled();
        expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('blocks read-only staff from submitting even when they own the surat', async () => {
        enqueue([{
            id: 'surat-1',
            unitKerjaId: 'unit-a',
            createdBy: staff.id,
            approvalStatus: 'draft',
            isArchived: false,
            isDeleted: false,
            isSigned: false,
        }]);

        await expect(approvalService.submit(
            'surat-1',
            staff,
            'admin-2',
            'unit-a',
        )).rejects.toThrow('tidak memiliki kewenangan mengajukan');

        expect(mockDb.insert).not.toHaveBeenCalled();
        expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('rejects a staff user selected as approver even in the same unit', async () => {
        enqueue(
            [{
                id: 'surat-1',
                unitKerjaId: 'unit-a',
                createdBy: unitAdmin.id,
                approvalStatus: 'draft',
                isArchived: false,
                isDeleted: false,
                isSigned: false,
            }],
            [{ id: 'staff-approver', role: 'staff', unitKerjaId: 'unit-a', isActive: true }],
        );

        await expect(approvalService.submit(
            'surat-1',
            unitAdmin,
            'staff-approver',
            'unit-a',
        )).rejects.toThrow('Penyetuju harus administrator aktif');

        expect(mockDb.insert).not.toHaveBeenCalled();
        expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('blocks staff and out-of-unit administrators from approval actions', async () => {
        enqueue([{
            id: 'surat-1',
            unitKerjaId: 'unit-a',
            approvalStatus: 'pending',
            currentApproverId: staff.id,
            isArchived: false,
            isDeleted: false,
            isSigned: false,
        }]);
        await expect(approvalService.approve('surat-1', staff, 'unit-a'))
            .rejects.toThrow('Hanya pejabat administrator');

        enqueue([{
            id: 'surat-2',
            unitKerjaId: 'unit-b',
            approvalStatus: 'pending',
            currentApproverId: adminDirjen.id,
            isArchived: false,
            isDeleted: false,
            isSigned: false,
        }]);
        await expect(approvalService.reject('surat-2', adminDirjen, null, 'Tidak sesuai'))
            .rejects.toThrow('unit kerja yang dimandatkan');

        expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('fails closed when a conditional approval step update loses a race', async () => {
        enqueue(
            [{
                id: 'surat-1',
                unitKerjaId: 'ditjen',
                approvalStatus: 'pending',
                currentApproverId: adminDirjen.id,
                isArchived: false,
                isDeleted: false,
                isSigned: false,
            }],
            [{
                id: 'request-1',
                requesterId: 'requester-1',
                currentStepOrder: 1,
                status: 'pending',
            }],
            [{
                id: 'step-1',
                approverId: adminDirjen.id,
                status: 'pending',
            }],
            [],
        );

        await expect(approvalService.approve('surat-1', adminDirjen, 'ditjen'))
            .rejects.toThrow('Langkah persetujuan telah diproses');

        expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('never persists a simulated signature and reports PSrE signing as not operational', async () => {
        enqueue(
            [{
                id: 'surat-1',
                unitKerjaId: 'ditjen',
                approvalStatus: 'approved',
                isArchived: false,
                isDeleted: false,
                isSigned: false,
            }],
            [{
                id: 'request-1',
                requesterId: 'requester-1',
                currentStepOrder: 2,
                status: 'approved',
            }],
            [{
                id: 'step-2',
                approverId: adminDirjen.id,
                status: 'approved',
            }],
        );

        await expect(signatureService.sign('surat-1', adminDirjen, 'ditjen', 'secret'))
            .rejects.toMatchObject({ statusCode: 501 });

        expect(mockDb.insert).not.toHaveBeenCalled();
        expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('blocks staff from signing before any signature mutation', async () => {
        enqueue([{
            id: 'surat-1',
            unitKerjaId: 'unit-a',
            approvalStatus: 'approved',
            isArchived: false,
            isDeleted: false,
            isSigned: false,
        }]);

        await expect(signatureService.sign('surat-1', staff, 'unit-a', 'secret'))
            .rejects.toThrow('Hanya pejabat administrator');

        expect(mockDb.insert).not.toHaveBeenCalled();
        expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('downgrades legacy MOCK-SIG records instead of claiming validity', async () => {
        enqueue([{
            id: 'signature-1',
            entityType: 'surat_keluar',
            entityId: 'surat-1',
            signerId: 'admin-1',
            signedAt: new Date('2026-01-01T00:00:00Z'),
            certificateId: 'MOCK-CERT-123',
            signatureValue: 'MOCK-SIG-abc',
            isValid: true,
        }]);

        const result = await signatureService.verify('signature-1');

        expect(result).toMatchObject({
            isValid: false,
            verificationStatus: 'simulation_not_valid',
        });
        expect(result).not.toHaveProperty('signatureValue');
    });
});
