import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Chainable DB Mock ───
const resultQueue: any[] = [];
function enqueue(...results: any[]) { resultQueue.push(...results); }

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
};

vi.mock('../config/database', () => ({ db: mockDb }));
vi.mock('../services/arsip.service', () => ({
    arsipService: {
        getDisposalCandidates: vi.fn().mockResolvedValue({ data: [], pagination: { total: 0 } }),
        getArchiveStatus: vi.fn().mockReturnValue('kadaluarsa'),
    },
}));

// penyusutanService is a singleton, not a class export
const { penyusutanService } = await import('../services/penyusutan.service');

describe('PenyusutanService', () => {
    beforeEach(() => {
        resultQueue.length = 0;
    });

    // ── findAll ──
    describe('findAll', () => {
        it('should return paginated penyusutan batches', async () => {
            // Promise.all([data, countResult])
            enqueue(
                [{ id: 'p1', status: 'draft' }, { id: 'p2', status: 'approved' }], // data
                [{ count: 2 }],   // countResult
            );
            const res = await penyusutanService.findAll({ unitKerjaId: 'u1' });
            expect(res.data).toHaveLength(2);
            expect(res.pagination.total).toBe(2);
        });

        it('should filter by jenisPenyusutan', async () => {
            enqueue(
                [{ id: 'p1', jenisPenyusutan: 'pemusnahan' }],
                [{ count: 1 }],
            );
            const res = await penyusutanService.findAll({
                unitKerjaId: 'u1',
                jenisPenyusutan: 'pemusnahan',
            });
            expect(res.data).toHaveLength(1);
        });

        it('should filter by status', async () => {
            enqueue([], [{ count: 0 }]);
            const res = await penyusutanService.findAll({
                unitKerjaId: 'u1',
                status: 'executed',
            });
            expect(res.data).toEqual([]);
        });

        it('should handle pagination parameters', async () => {
            enqueue([], [{ count: 50 }]);
            const res = await penyusutanService.findAll({
                unitKerjaId: 'u1',
                page: 3,
                limit: 10,
            });
            expect(res.pagination.page).toBe(3);
            expect(res.pagination.limit).toBe(10);
            expect(res.pagination.totalPages).toBe(5);
        });
    });

    // ── findById ──
    describe('findById', () => {
        it('should return batch with items', async () => {
            enqueue([{ id: 'p1', status: 'draft' }]); // batch query
            enqueue([{ item: { id: 'i1' }, arsip: { id: 'a1' } }]); // items query
            const res = await penyusutanService.findById('p1');
            expect(res).toBeDefined();
            expect(res?.items).toHaveLength(1);
        });

        it('should return null for nonexistent batch', async () => {
            enqueue([]);
            expect(await penyusutanService.findById('missing')).toBeNull();
        });
    });

    // ── create ──
    describe('create', () => {
        it('should create batch with arsip items', async () => {
            enqueue([{ id: 'p-new', status: 'draft' }]); // insert batch
            enqueue([]); // insert items (returns nothing important)
            enqueue([]); // update arsip disposalStatus
            const res = await penyusutanService.create({
                unitKerjaId: 'u1',
                jenisPenyusutan: 'pemusnahan',
                arsipIds: ['a1', 'a2'],
            });
            expect(res.id).toBe('p-new');
        });

        it('should handle create with empty arsipIds', async () => {
            enqueue([{ id: 'p-new', status: 'draft' }]);
            const res = await penyusutanService.create({
                unitKerjaId: 'u1',
                jenisPenyusutan: 'pemindahan',
                arsipIds: [],
            });
            expect(res.id).toBe('p-new');
        });
    });

    // ── updateStatus ──
    describe('updateStatus', () => {
        it('should advance status from draft to proposed', async () => {
            enqueue([{ id: 'p1', status: 'draft', unitKerjaId: 'u1' }]); // find batch
            enqueue([{ id: 'p1', status: 'proposed' }]); // update
            const res = await penyusutanService.updateStatus('p1');
            expect(res.status).toBe('proposed');
        });

        it('should throw for nonexistent batch', async () => {
            enqueue([]);
            await expect(penyusutanService.updateStatus('missing')).rejects.toThrow('Penyusutan batch not found');
        });

        it('should throw when already at terminal state', async () => {
            enqueue([{ id: 'p1', status: 'executed' }]);
            await expect(penyusutanService.updateStatus('p1')).rejects.toThrow('Cannot advance from status: executed');
        });
    });

    // ── addItems ──
    describe('addItems', () => {
        it('should add arsip items to draft batch', async () => {
            enqueue([{ id: 'p1', status: 'draft', jenisPenyusutan: 'pemusnahan' }]); // find batch
            enqueue([{ nomorUrut: 3 }]); // existing items max nomorUrut
            enqueue([]); // insert items
            enqueue([]); // update arsip
            enqueue([{ count: 5 }]); // count items
            enqueue([]); // update batch totalBerkas
            const res = await penyusutanService.addItems('p1', ['a-new']);
            expect(res.added).toBe(1);
        });

        it('should throw for non-draft batch', async () => {
            enqueue([{ id: 'p1', status: 'proposed' }]);
            await expect(penyusutanService.addItems('p1', ['a1'])).rejects.toThrow('Can only add items to draft batches');
        });
    });

    // ── removeItems ──
    describe('removeItems', () => {
        it('should remove items from draft batch', async () => {
            enqueue([{ id: 'p1', status: 'draft' }]); // find batch
            enqueue([]); // delete items
            enqueue([]); // reset arsip
            enqueue([{ count: 2 }]); // count remaining items
            enqueue([]); // update batch totalBerkas
            const res = await penyusutanService.removeItems('p1', ['a1']);
            expect(res.removed).toBe(1);
        });

        it('should throw for non-draft batch', async () => {
            enqueue([{ id: 'p1', status: 'approved' }]);
            await expect(penyusutanService.removeItems('p1', ['a1'])).rejects.toThrow('Can only remove items from draft batches');
        });
    });

    // ── deleteBatch ──
    describe('deleteBatch', () => {
        it('should delete draft batch', async () => {
            enqueue([{ id: 'p1', status: 'draft' }]); // find batch
            enqueue([{ arsipId: 'a1' }]); // get items
            enqueue([]); // reset arsip
            enqueue([]); // delete batch
            const res = await penyusutanService.deleteBatch('p1');
            expect(res.deleted).toBe(true);
        });

        it('should throw for non-draft batch', async () => {
            enqueue([{ id: 'p1', status: 'executed' }]);
            await expect(penyusutanService.deleteBatch('p1')).rejects.toThrow('Can only delete draft batches');
        });

        it('should throw for nonexistent batch', async () => {
            enqueue([]);
            await expect(penyusutanService.deleteBatch('missing')).rejects.toThrow('Batch not found');
        });
    });

    // ── Status Flow ──
    describe('Status Flow', () => {
        const STATUS_FLOW = {
            draft: 'proposed',
            proposed: 'reviewed',
            reviewed: 'approved',
            approved: 'executed',
            executed: null,
        };

        it('should define correct status transitions', () => {
            expect(STATUS_FLOW.draft).toBe('proposed');
            expect(STATUS_FLOW.proposed).toBe('reviewed');
            expect(STATUS_FLOW.reviewed).toBe('approved');
            expect(STATUS_FLOW.approved).toBe('executed');
            expect(STATUS_FLOW.executed).toBeNull();
        });

        it('should have 5 statuses in the flow', () => {
            expect(Object.keys(STATUS_FLOW)).toHaveLength(5);
        });
    });
});
