import { beforeEach, describe, expect, it, vi } from 'vitest';

const resultQueue: any[] = [];
const emailMocks = vi.hoisted(() => ({
    sendApprovalNotification: vi.fn(),
}));
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
    execute: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(async (callback: any) => callback(mockDb)),
};

vi.mock('../config/database.js', () => ({ db: mockDb }));
vi.mock('../services/email.service.js', () => ({
    emailService: emailMocks,
}));
vi.mock('../utils/logger.js', () => ({
    createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

const { ApprovalService, buildApprovalReviewUrl } = await import('../services/approval.service.js');
const { SignatureService } = await import('../services/signature.service.js');

const staff = {
    id: 'staff-1',
    role: 'staff',
    unitKerjaId: 'unit-a',
    isActive: true,
};
const adminDirjen = {
    id: 'admin-1',
    role: 'admin_dirjen',
    unitKerjaId: null,
    isActive: true,
};
const unitAdmin = {
    id: 'super-unit-a',
    role: 'super_admin',
    unitKerjaId: 'unit-a',
    isActive: true,
};

describe('approval and signature service security', () => {
    let approvalService: InstanceType<typeof ApprovalService>;
    let signatureService: InstanceType<typeof SignatureService>;

    beforeEach(() => {
        vi.clearAllMocks();
        resultQueue.length = 0;
        approvalService = new ApprovalService();
        signatureService = new SignatureService();
        emailMocks.sendApprovalNotification.mockResolvedValue({ sent: true, status: 'sent' });
    });

    it('builds approval links only from the configured frontend origin', () => {
        expect(buildApprovalReviewUrl(
            'https://simsa.example.test/',
            '550e8400-e29b-41d4-a716-446655440001',
        )).toBe(
            'https://simsa.example.test/surat/keluar/550e8400-e29b-41d4-a716-446655440001',
        );
        expect(() => buildApprovalReviewUrl('javascript:alert(1)', 'surat-1'))
            .toThrow('HTTP(S)');
        expect(() => buildApprovalReviewUrl('https://simsa.example.test/subpath', 'surat-1'))
            .toThrow('without credentials, path');
    });

    it('sends approval email only after the target user explicitly opts in', async () => {
        const surat = { id: 'surat-1', nomorSurat: 'SK-1' };
        const target = { id: 'approver-1', email: 'approver@example.test' };
        const requester = { id: 'requester-1', name: 'Pemohon' };

        enqueue([surat], [target], [requester], []);
        await (approvalService as any).sendNotification(surat.id, target.id, requester.id);
        expect(emailMocks.sendApprovalNotification).not.toHaveBeenCalled();

        enqueue([surat], [target], [requester], [{ emailNotifications: true }]);
        await (approvalService as any).sendNotification(surat.id, target.id, requester.id);
        expect(emailMocks.sendApprovalNotification).toHaveBeenCalledTimes(1);
    });

    it('waits for post-commit notification work before submit and approve return', async () => {
        let releaseSubmit!: () => void;
        const submitGate = new Promise<void>((resolve) => { releaseSubmit = resolve; });
        const notify = vi.spyOn(approvalService as any, 'sendNotification')
            .mockReturnValueOnce(submitGate);
        mockDb.transaction.mockResolvedValueOnce({
            request: { id: 'request-submit' },
            notifyUserId: 'approver-1',
        });

        let submitSettled = false;
        const submitPromise = approvalService.submit(
            'surat-1', unitAdmin, 'approver-1', 'unit-a',
        ).then((result) => {
            submitSettled = true;
            return result;
        });
        await Promise.resolve();
        expect(submitSettled).toBe(false);
        releaseSubmit();
        await expect(submitPromise).resolves.toMatchObject({ id: 'request-submit' });

        let releaseApproval!: () => void;
        const approvalGate = new Promise<void>((resolve) => { releaseApproval = resolve; });
        notify.mockReturnValueOnce(approvalGate);
        mockDb.transaction.mockResolvedValueOnce({
            notifyUserId: 'approver-2',
            requesterId: 'requester-1',
        });

        let approvalSettled = false;
        const approvalPromise = approvalService.approve(
            'surat-1', unitAdmin, 'unit-a', undefined, 'approver-2',
        ).then((result) => {
            approvalSettled = true;
            return result;
        });
        await Promise.resolve();
        expect(approvalSettled).toBe(false);
        releaseApproval();
        await expect(approvalPromise).resolves.toEqual({ success: true });
        expect(notify).toHaveBeenCalledTimes(2);
    });

    it('fails closed when submit cannot find the surat in the caller unit scope', async () => {
        enqueue(
            [
                staff,
                { id: 'admin-2', role: 'super_admin', unitKerjaId: null, isActive: true },
            ],
            [],
        );

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
        enqueue(
            [
                unitAdmin,
                { id: 'admin-2', role: 'super_admin', unitKerjaId: null, isActive: true },
            ],
            [{
                id: 'surat-1',
                unitKerjaId: 'unit-a',
                createdBy: 'different-owner',
                approvalStatus: 'draft',
                isArchived: false,
                isDeleted: false,
                isSigned: false,
            }],
        );

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
        enqueue(
            [
                staff,
                { id: 'admin-2', role: 'super_admin', unitKerjaId: null, isActive: true },
            ],
            [{
                id: 'surat-1',
                unitKerjaId: 'unit-a',
                createdBy: staff.id,
                approvalStatus: 'draft',
                isArchived: false,
                isDeleted: false,
                isSigned: false,
            }],
        );

        await expect(approvalService.submit(
            'surat-1',
            staff,
            'admin-2',
            'unit-a',
        )).rejects.toThrow('tidak memiliki kewenangan mengajukan');

        expect(mockDb.insert).not.toHaveBeenCalled();
        expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('lists only active eligible approvers and excludes the maker', async () => {
        enqueue(
            [{
                id: 'surat-1',
                unitKerjaId: 'unit-a',
                createdBy: unitAdmin.id,
                approvalStatus: 'draft',
            }],
            [
                { id: unitAdmin.id, name: 'Maker', role: 'super_admin', isActive: true },
                { id: 'super-2', name: 'Reviewer', role: 'super_admin', isActive: true },
            ],
        );

        await expect(approvalService.listEligibleApprovers(
            'surat-1', unitAdmin, 'unit-a',
        )).resolves.toEqual([
            expect.objectContaining({ id: 'super-2', name: 'Reviewer' }),
        ]);
    });

    it('returns only pending steps assigned to the authenticated actor', async () => {
        const pending = [{ suratId: 'surat-1', requestId: 'request-1' }];
        enqueue(pending);

        await expect(approvalService.getPending(adminDirjen)).resolves.toEqual(pending);
        await expect(approvalService.getPending(staff)).rejects.toThrow('tidak memiliki kewenangan');
    });

    it('rejects a staff user selected as approver even in the same unit', async () => {
        enqueue(
            [
                unitAdmin,
                { id: 'staff-approver', role: 'staff', unitKerjaId: 'unit-a', isActive: true },
            ],
            [{
                id: 'surat-1',
                unitKerjaId: 'unit-a',
                createdBy: unitAdmin.id,
                approvalStatus: 'draft',
                isArchived: false,
                isDeleted: false,
                isSigned: false,
            }],
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

    it('uses the transaction-fresh actor mandate instead of the middleware snapshot', async () => {
        enqueue(
            [
                { ...unitAdmin, role: 'staff' },
                { id: 'admin-2', role: 'super_admin', unitKerjaId: null, isActive: true },
            ],
            [{
                id: 'surat-1',
                unitKerjaId: 'unit-a',
                createdBy: unitAdmin.id,
                approvalStatus: 'draft',
                isArchived: false,
                isDeleted: false,
                isSigned: false,
            }],
        );

        await expect(approvalService.submit(
            'surat-1',
            unitAdmin,
            'admin-2',
            null,
        )).rejects.toThrow('tidak memiliki kewenangan mengajukan');

        expect(mockDb.execute).toHaveBeenCalledOnce();
        expect(mockDb.execute.mock.invocationCallOrder[0])
            .toBeLessThan(mockDb.select.mock.invocationCallOrder[0]);
        expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('revalidates approve and reject actors while the shared mandate gate is held', async () => {
        const staleStaff = { ...adminDirjen, role: 'staff' };
        const surat = {
            id: 'surat-1',
            unitKerjaId: 'ditjen',
            approvalStatus: 'pending',
            currentApproverId: adminDirjen.id,
            isArchived: false,
            isDeleted: false,
            isSigned: false,
        };

        enqueue([staleStaff], [surat]);
        await expect(approvalService.approve('surat-1', adminDirjen, 'ditjen'))
            .rejects.toThrow('Hanya pejabat administrator');

        enqueue([{ ...adminDirjen, isActive: false }]);
        await expect(approvalService.reject('surat-1', adminDirjen, 'ditjen', 'Tidak sesuai'))
            .rejects.toThrow('mandat persetujuan telah dicabut');

        expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('rejects self-forwarding before opening a transaction or taking a user lock', async () => {
        await expect(approvalService.approve(
            'surat-1',
            adminDirjen,
            'ditjen',
            undefined,
            adminDirjen.id,
        )).rejects.toThrow('berbeda dari penyetuju saat ini');

        expect(mockDb.transaction).not.toHaveBeenCalled();
        expect(mockDb.execute).not.toHaveBeenCalled();
        expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('blocks staff and out-of-unit administrators from approval actions', async () => {
        enqueue(
            [staff],
            [{
                id: 'surat-1',
                unitKerjaId: 'unit-a',
                approvalStatus: 'pending',
                currentApproverId: staff.id,
                isArchived: false,
                isDeleted: false,
                isSigned: false,
            }],
        );
        await expect(approvalService.approve('surat-1', staff, 'unit-a'))
            .rejects.toThrow('Hanya pejabat administrator');

        enqueue(
            [adminDirjen],
            [{
                id: 'surat-2',
                unitKerjaId: 'unit-b',
                approvalStatus: 'pending',
                currentApproverId: adminDirjen.id,
                isArchived: false,
                isDeleted: false,
                isSigned: false,
            }],
        );
        await expect(approvalService.reject('surat-2', adminDirjen, null, 'Tidak sesuai'))
            .rejects.toThrow('unit kerja yang dimandatkan');

        expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('fails closed when a conditional approval step update loses a race', async () => {
        enqueue(
            [adminDirjen],
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
