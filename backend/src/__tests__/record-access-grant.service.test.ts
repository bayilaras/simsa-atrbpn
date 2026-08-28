import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const selectQueue: any[] = [];
    const updateQueue: any[] = [];
    const chain: any = {};
    chain.select = vi.fn(() => chain);
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
    chain.limit = vi.fn(async () => selectQueue.shift() || []);
    chain.update = vi.fn(() => chain);
    chain.insert = vi.fn(() => chain);
    chain.set = vi.fn(() => chain);
    chain.values = vi.fn(() => chain);
    chain.for = vi.fn(() => chain);
    chain.returning = vi.fn(async () => updateQueue.shift() || []);
    chain.transaction = vi.fn();
    return {
        chain,
        selectQueue,
        updateQueue,
        audit: vi.fn(),
        transactionCommits: 0,
        transactionRollbacks: 0,
    };
});

vi.mock('../config/database', () => ({ db: mocks.chain }));
vi.mock('../services/audit-log.service.js', () => ({
    default: { logActionOrThrow: mocks.audit },
}));

import { recordAccessService } from '../services/record-access.service';
import { recordAccessGrantService } from '../services/record-access-grant.service';

const user = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    role: 'admin_dirjen',
    unitKerjaId: 'ditjen',
};

describe('purpose-bound record access', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.selectQueue.length = 0;
        mocks.updateQueue.length = 0;
        mocks.chain.transaction.mockReset();
        mocks.transactionCommits = 0;
        mocks.transactionRollbacks = 0;
        mocks.audit.mockReset();
        mocks.audit.mockResolvedValue(undefined);
        mocks.chain.transaction.mockImplementation(async (fn: any) => {
            try {
                const result = await fn(mocks.chain);
                mocks.transactionCommits += 1;
                return result;
            } catch (error) {
                mocks.transactionRollbacks += 1;
                throw error;
            }
        });
    });

    it('denies controlled records when role exists but no active grant exists', async () => {
        mocks.selectQueue.push([{
            unitKerjaId: 'ditjen',
            classification: 'terbatas',
            disposalStatus: 'active',
            legalHold: false,
        }], []);

        const result = await recordAccessService.check(user, 'arsip', '550e8400-e29b-41d4-a716-446655440010');

        expect(result.exists).toBe(true);
        expect(result.allowed).toBe(false);
        expect(result.mutable).toBe(false);
        expect(result.grantId).toBeNull();
    });

    it.each(['view', 'download'] as const)(
        'allows reading but not mutation with an active %s grant',
        async (accessMode) => {
            const expiresAt = new Date('2026-08-27T00:00:00.000Z');
            mocks.selectQueue.push([{
                unitKerjaId: 'ditjen',
                classification: 'Rahasia',
                disposalStatus: 'active',
                legalHold: false,
            }], [{
                id: '550e8400-e29b-41d4-a716-446655440020',
                purpose: 'Penelaahan perkara pengadaan tanah',
                accessMode,
                expiresAt,
            }]);

            const result = await recordAccessService.check(
                user,
                'arsip',
                '550e8400-e29b-41d4-a716-446655440010',
            );

            expect(result).toMatchObject({
                allowed: true,
                mutable: false,
                grantId: '550e8400-e29b-41d4-a716-446655440020',
                accessPurpose: 'Penelaahan perkara pengadaan tanah',
                grantAccessMode: accessMode,
                grantExpiresAt: expiresAt,
            });
        },
    );

    it('allows mutation only with an active manage grant', async () => {
        mocks.selectQueue.push([{
            unitKerjaId: 'ditjen',
            classification: 'Rahasia',
            disposalStatus: 'active',
            legalHold: false,
        }], [{
            id: '550e8400-e29b-41d4-a716-446655440020',
            purpose: 'Pemutakhiran metadata perkara pengadaan tanah',
            accessMode: 'manage',
            expiresAt: new Date('2026-08-27T00:00:00.000Z'),
        }]);

        const result = await recordAccessService.check(
            user,
            'arsip',
            '550e8400-e29b-41d4-a716-446655440010',
        );

        expect(result).toMatchObject({
            allowed: true,
            mutable: true,
            grantAccessMode: 'manage',
        });
    });

    it('keeps auditors immutable even when they hold a manage grant', async () => {
        mocks.selectQueue.push([{
            unitKerjaId: 'ditjen',
            classification: 'terbatas',
            disposalStatus: 'active',
            legalHold: false,
        }], [{
            id: '550e8400-e29b-41d4-a716-446655440020',
            purpose: 'Pemeriksaan kepatuhan pengelolaan arsip elektronik',
            accessMode: 'manage',
            expiresAt: new Date('2026-08-27T00:00:00.000Z'),
        }]);

        const result = await recordAccessService.check(
            { ...user, role: 'auditor' },
            'arsip',
            '550e8400-e29b-41d4-a716-446655440010',
        );

        expect(result.allowed).toBe(true);
        expect(result.mutable).toBe(false);
    });

    it('fails closed for an unknown classification even for super_admin', async () => {
        mocks.selectQueue.push([{
            unitKerjaId: 'ditjen',
            classification: 'internal-khusus',
            disposalStatus: 'active',
            legalHold: false,
        }]);

        const result = await recordAccessService.check(
            { ...user, role: 'super_admin', unitKerjaId: null },
            'arsip',
            '550e8400-e29b-41d4-a716-446655440010',
        );

        expect(result.allowed).toBe(false);
        expect(result.mutable).toBe(false);
        expect(mocks.chain.select).toHaveBeenCalledTimes(1);
    });

    it('does not expose an unknown classification through the grant request flow', async () => {
        mocks.selectQueue.push([{
            unitKerjaId: 'ditjen',
            classification: 'internal-khusus',
            disposalStatus: 'active',
            legalHold: false,
        }]);

        const result = await recordAccessService.inspect(
            { ...user, role: 'super_admin', unitKerjaId: null },
            'arsip',
            '550e8400-e29b-41d4-a716-446655440010',
        );

        expect(result.exists).toBe(true);
        expect(result.requestable).toBe(false);
    });

    it('does not require a grant for ordinary records', async () => {
        mocks.selectQueue.push([{
            unitKerjaId: 'ditjen',
            classification: 'Biasa/Terbuka',
            disposalStatus: 'active',
            legalHold: false,
        }]);

        const result = await recordAccessService.check(user, 'arsip', '550e8400-e29b-41d4-a716-446655440010');

        expect(result.allowed).toBe(true);
        expect(result.mutable).toBe(true);
        expect(result.grantId).toBeNull();
        expect(mocks.chain.select).toHaveBeenCalledTimes(1);
    });

    it('atomically refuses to mark a revoked or expired grant as used', async () => {
        mocks.updateQueue.push([]);
        await expect(recordAccessService.markGrantUsed('550e8400-e29b-41d4-a716-446655440020'))
            .resolves.toBe(false);

        mocks.updateQueue.push([{ id: '550e8400-e29b-41d4-a716-446655440020' }]);
        await expect(recordAccessService.markGrantUsed('550e8400-e29b-41d4-a716-446655440020'))
            .resolves.toBe(true);
    });

    it('maps a concurrent duplicate request to a domain conflict', async () => {
        mocks.selectQueue.push([{
            unitKerjaId: 'ditjen',
            classification: 'terbatas',
            disposalStatus: 'active',
            legalHold: false,
        }]);
        mocks.chain.transaction.mockRejectedValueOnce(
            Object.assign(new Error('duplicate key'), { code: '23505' }),
        );

        await expect(recordAccessGrantService.request(user, {
            entityType: 'arsip',
            entityId: '550e8400-e29b-41d4-a716-446655440010',
            purpose: 'Penelaahan perkara pengadaan tanah',
            accessMode: 'view',
        })).rejects.toThrow(/Permohonan aktif/);
    });

    it('rolls back a new access request when its critical audit insert fails', async () => {
        mocks.selectQueue.push(
            [{
                unitKerjaId: 'ditjen',
                classification: 'terbatas',
                disposalStatus: 'active',
                legalHold: false,
            }],
            [],
        );
        mocks.updateQueue.push([], [{
            id: '550e8400-e29b-41d4-a716-446655440030',
            requesterId: user.id,
            targetUserId: user.id,
            entityType: 'arsip',
            entityId: '550e8400-e29b-41d4-a716-446655440010',
            unitKerjaId: 'ditjen',
            requiredClassification: 'terbatas',
            purpose: 'Penelaahan perkara pengadaan tanah',
            accessMode: 'view',
            status: 'pending',
        }]);
        mocks.audit.mockRejectedValueOnce(new Error('audit unavailable'));

        await expect(recordAccessGrantService.request(user, {
            entityType: 'arsip',
            entityId: '550e8400-e29b-41d4-a716-446655440010',
            purpose: 'Penelaahan perkara pengadaan tanah',
            accessMode: 'view',
        }, { userId: user.id })).rejects.toThrow('audit unavailable');

        expect(mocks.transactionCommits).toBe(0);
        expect(mocks.transactionRollbacks).toBe(1);
        expect(mocks.audit).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'request_access', entityType: 'record_access_grant' }),
            mocks.chain,
        );
    });

    it('rolls back automatic grant expiry when its audit cannot be persisted', async () => {
        mocks.updateQueue.push([{
            id: '550e8400-e29b-41d4-a716-446655440030',
            status: 'expired',
        }]);
        mocks.audit.mockRejectedValueOnce(new Error('audit unavailable'));

        await expect(recordAccessGrantService.listMine(
            user.id,
            { page: 1, limit: 20 },
            { userId: user.id },
        )).rejects.toThrow('audit unavailable');

        expect(mocks.transactionCommits).toBe(0);
        expect(mocks.transactionRollbacks).toBe(1);
        expect(mocks.audit).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'status_change',
                entityType: 'record_access_grant',
            }),
            mocks.chain,
        );
    });
});
