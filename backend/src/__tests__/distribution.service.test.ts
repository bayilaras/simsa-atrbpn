import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Chainable DB Mock ───
const resultQueue: any[] = [];
let transactionCommits = 0;
let transactionRollbacks = 0;
function enqueue(...results: any[]) { resultQueue.push(...results); }

const auditMocks = vi.hoisted(() => ({ logActionOrThrow: vi.fn() }));

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const val = resultQueue.shift() ?? [];
            return (resolve: any) => resolve(val);
        }
        return (..._args: any[]) => mockChain;
    },
});

const mockDb = {
    select: (..._a: any[]) => mockChain,
    insert: (..._a: any[]) => mockChain,
    update: (..._a: any[]) => mockChain,
    delete: (..._a: any[]) => mockChain,
    transaction: async (fn: any) => {
        try {
            const result = await fn(mockDb);
            transactionCommits += 1;
            return result;
        } catch (error) {
            transactionRollbacks += 1;
            throw error;
        }
    },
};

vi.mock('../config/database', () => ({ db: mockDb }));
vi.mock('../services/audit-log.service.js', () => ({ default: auditMocks }));

const { DistributionService } = await import('../services/distribution.service');

describe('DistributionService', () => {
    let svc: InstanceType<typeof DistributionService>;

    beforeEach(() => {
        svc = new DistributionService();
        resultQueue.length = 0;
        transactionCommits = 0;
        transactionRollbacks = 0;
        auditMocks.logActionOrThrow.mockReset();
        auditMocks.logActionOrThrow.mockResolvedValue(undefined);
    });

    // ── distribute ──
    describe('distribute', () => {
        it('should create distribution when no existing one', async () => {
            enqueue([{ id: 'sm-1' }]); // source letter belongs to source unit
            enqueue([]);  // existing check → none
            enqueue([{ id: 'dist-1', status: 'sent' }]); // insert returning
            const res = await svc.distribute({
                suratMasukId: 'sm-1',
                sourceUnitId: 'ditjen',
                targetUnitId: 'unit-1',
            });
            expect(res.id).toBe('dist-1');
            expect(res.status).toBe('sent');
        });

        it('rolls back distribution creation when its critical audit insert fails', async () => {
            enqueue([{ id: 'sm-1' }], [], [{ id: 'dist-1', status: 'sent' }]);
            auditMocks.logActionOrThrow.mockRejectedValueOnce(new Error('audit unavailable'));

            await expect(svc.distribute({
                suratMasukId: 'sm-1',
                sourceUnitId: 'ditjen',
                targetUnitId: 'unit-1',
            }, { userId: 'user-1' })).rejects.toThrow('audit unavailable');

            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
            expect(auditMocks.logActionOrThrow).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'distribute', entityType: 'surat_distribution' }),
                mockDb,
            );
        });

        it('should throw when already distributed to same unit', async () => {
            enqueue([{ id: 'sm-1' }]); // source letter belongs to source unit
            enqueue([{ id: 'existing' }]); // existing check → found
            await expect(svc.distribute({
                suratMasukId: 'sm-1',
                sourceUnitId: 'ditjen',
                targetUnitId: 'unit-1',
            })).rejects.toThrow('Surat sudah didistribusikan ke unit ini');
        });

        it('should fail closed when the source unit does not own the letter', async () => {
            enqueue([]);
            await expect(svc.distribute({
                suratMasukId: 'foreign-letter',
                sourceUnitId: 'unit-a',
                targetUnitId: 'unit-b',
            })).rejects.toThrow('Surat not found');
        });
    });

    // ── findInbox ──
    describe('findInbox', () => {
        it('should return paginated inbox', async () => {
            enqueue(
                [{ count: 10 }],  // count query
                [{ distribution: { id: 'd1' }, surat: { id: 's1' }, sourceUnit: { id: 'u1', name: 'U1' } }],
            );
            const res = await svc.findInbox('unit-1');
            expect(res.data).toHaveLength(1);
            expect(res.pagination.total).toBe(10);
        });

        it('should apply status filter', async () => {
            enqueue([{ count: 0 }], []);
            const res = await svc.findInbox('unit-1', { status: 'received', page: 1, limit: 10 });
            expect(res.data).toEqual([]);
        });
    });

    // ── findOutbox ──
    describe('findOutbox', () => {
        it('should return paginated outbox', async () => {
            enqueue([{ count: 3 }], []);
            const res = await svc.findOutbox('ditjen');
            expect(res.pagination.total).toBe(3);
        });
    });

    // ── receive ──
    describe('receive', () => {
        it('should mark distribution as received', async () => {
            enqueue([{ id: 'dist-1', status: 'sent' }]);  // findById
            enqueue([{ id: 'dist-1', status: 'received', receivedBy: 'user-1' }]); // update
            const res = await svc.receive('dist-1', 'user-1', 'unit-1');
            expect(res.status).toBe('received');
        });

        it('should throw if distribution not found', async () => {
            enqueue([]);
            await expect(svc.receive('missing', 'u1', 'unit-1')).rejects.toThrow('Distribution not found');
        });

        it('should throw if already received', async () => {
            enqueue([{ id: 'dist-1', status: 'received' }]);
            await expect(svc.receive('dist-1', 'u1', 'unit-1')).rejects.toThrow();
        });
    });

    // ── process ──
    describe('process', () => {
        it('should process only a received distribution', async () => {
            enqueue([{ id: 'dist-1', status: 'received' }]);
            enqueue([{ id: 'dist-1', status: 'processed' }]);

            const result = await svc.process('dist-1', 'unit-1');
            expect(result.status).toBe('processed');
        });

        it.each(['sent', 'rejected', 'processed'])(
            'should reject a %s distribution',
            async (status) => {
                enqueue([{ id: 'dist-1', status }]);
                await expect(svc.process('dist-1', 'unit-1'))
                    .rejects.toThrow(/hanya dapat diproses setelah diterima/);
            },
        );

        it('should reject when a concurrent transition changed the received state', async () => {
            enqueue([{ id: 'dist-1', status: 'received' }]);
            enqueue([]);

            await expect(svc.process('dist-1', 'unit-1'))
                .rejects.toThrow(/hanya dapat diproses setelah diterima/);
        });
    });

    // ── reject ──
    describe('reject', () => {
        it('should reject distribution with reason', async () => {
            enqueue([{ id: 'dist-1', status: 'sent' }]); // find
            enqueue([{ id: 'dist-1', status: 'rejected', rejectionReason: 'Salah unit' }]); // update
            const res = await svc.reject('dist-1', 'Salah unit', 'unit-1');
            expect(res.status).toBe('rejected');
        });

        it('should throw if distribution not found', async () => {
            enqueue([]);
            await expect(svc.reject('missing', 'reason', 'unit-1')).rejects.toThrow();
        });

        it('should throw if already processed', async () => {
            enqueue([{ id: 'dist-1', status: 'processed' }]);
            await expect(svc.reject('dist-1', 'reason', 'unit-1')).rejects.toThrow();
        });
    });

    // ── findById ──
    describe('findById', () => {
        it('should return distribution with surat details', async () => {
            enqueue([{
                distribution: { id: 'dist-1', suratMasukId: 'sm-1' },
                surat: { id: 'sm-1', perihal: 'Test' },
            }]);
            const res = await svc.findById('dist-1', 'unit-1');
            expect(res?.surat.id).toBe('sm-1');
        });

        it('should return null when not found', async () => {
            enqueue([]);
            expect(await svc.findById('missing', 'unit-1')).toBeNull();
        });
    });

    // ── getStats ──
    describe('getStats', () => {
        it('should return inbox and outbox statistics', async () => {
            enqueue([{ total: 20, pending: 5, received: 10, processed: 5, rejected: 0 }]); // inbox
            enqueue([{ total: 15, pending: 3, processed: 10, rejected: 2 }]); // outbox
            const res = await svc.getStats('unit-1');
            expect(res.inbox.total).toBe(20);
            expect(res.outbox.total).toBe(15);
        });
    });

    // ── isDistributed ──
    describe('isDistributed', () => {
        it('should return true when surat has distributions', async () => {
            enqueue([{ count: 3 }]);
            expect(await svc.isDistributed('sm-1', 'unit-1')).toBe(true);
        });

        it('should return false when no distributions exist', async () => {
            enqueue([{ count: 0 }]);
            expect(await svc.isDistributed('sm-99', 'unit-1')).toBe(false);
        });
    });
});
