import { beforeEach, describe, expect, it, vi } from 'vitest';

const resultQueue: any[] = [];
let transactionCommits = 0;
let transactionRollbacks = 0;

const auditMocks = vi.hoisted(() => ({
    logActionOrThrow: vi.fn(),
}));

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const value = resultQueue.shift() ?? [];
            return (resolve: (result: any) => void) => resolve(value);
        }
        return (..._args: any[]) => mockChain;
    },
});

const mockDb: any = {
    select: vi.fn(() => mockChain),
    insert: vi.fn(() => mockChain),
    update: vi.fn(() => mockChain),
    delete: vi.fn(() => mockChain),
    transaction: vi.fn(async (callback: (tx: any) => Promise<any>) => {
        try {
            const result = await callback(mockDb);
            transactionCommits += 1;
            return result;
        } catch (error) {
            transactionRollbacks += 1;
            throw error;
        }
    }),
};

vi.mock('../config/database', () => ({ db: mockDb }));
vi.mock('../services/audit-log.service.js', () => ({ default: auditMocks }));

const { arsipVitalService } = await import('../services/arsip-vital.service.js');
const { arsipTerjagaService } = await import('../services/arsip-terjaga.service.js');

const auditContext = {
    userId: 'user-1',
    userEmail: 'user@example.test',
    ipAddress: '127.0.0.1',
};

describe('Arsip Vital and Arsip Terjaga transactional audit', () => {
    beforeEach(() => {
        resultQueue.length = 0;
        transactionCommits = 0;
        transactionRollbacks = 0;
        vi.clearAllMocks();
        auditMocks.logActionOrThrow.mockResolvedValue(undefined);
    });

    it('rolls back a vital designation when critical audit storage fails', async () => {
        const created = {
            id: 'vital-1',
            arsipId: 'arsip-1',
            unitKerjaId: 'unit-1',
            kategoriVital: 'operasional',
        };
        resultQueue.push([created]);
        auditMocks.logActionOrThrow.mockRejectedValueOnce(new Error('audit unavailable'));

        await expect(arsipVitalService.create({
            arsipId: 'arsip-1',
            unitKerjaId: 'unit-1',
            kategoriVital: 'operasional',
            tingkatKekritisan: 'kritis',
        } as any, auditContext)).rejects.toThrow('audit unavailable');

        expect(transactionCommits).toBe(0);
        expect(transactionRollbacks).toBe(1);
        expect(auditMocks.logActionOrThrow).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'create',
                entityType: 'arsip',
                entityId: 'arsip-1',
            }),
            mockDb,
        );
    });

    it('rolls back an ANRI reporting status change when critical audit storage fails', async () => {
        const existing = {
            id: 'terjaga-1',
            arsipId: 'arsip-1',
            unitKerjaId: 'unit-1',
            statusPelaporan: 'belum_dilaporkan',
        };
        const updated = {
            ...existing,
            statusPelaporan: 'dilaporkan',
            nomorLaporanANRI: 'ANRI-001',
            tanggalPelaporan: '2026-08-28',
            statusKepatuhan: 'patuh',
        };
        resultQueue.push([existing], [updated]);
        auditMocks.logActionOrThrow.mockRejectedValueOnce(new Error('audit unavailable'));

        await expect(arsipTerjagaService.markAsReported(
            'terjaga-1',
            'ANRI-001',
            '2026-08-28',
            'unit-1',
            auditContext,
        )).rejects.toThrow('audit unavailable');

        expect(transactionCommits).toBe(0);
        expect(transactionRollbacks).toBe(1);
        expect(auditMocks.logActionOrThrow).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'status_change',
                entityType: 'arsip',
                entityId: 'arsip-1',
            }),
            mockDb,
        );
    });
});
