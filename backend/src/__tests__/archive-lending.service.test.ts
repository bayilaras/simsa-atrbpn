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
    transaction: async (fn: any) => fn(mockDb),
};

vi.mock('../config/database', () => ({ db: mockDb }));

const { archiveLendingService } = await import('../services/archive-lending.service');

describe('ArchiveLendingService', () => {
    beforeEach(() => { resultQueue.length = 0; });

    describe('findAll', () => {
        it('should return paginated records', async () => {
            enqueue([{ count: 20 }]); // count query destructured: [{ count }]
            enqueue([{ lending: { id: 'l1', status: 'borrowed' }, borrower: { id: 'u1', name: 'John' } }]); // data with join
            const result = await archiveLendingService.findAll({ page: 1, limit: 10 });
            expect(result.data).toHaveLength(1);
            expect(result.pagination.total).toBe(20);
            expect(result.pagination.totalPages).toBe(2);
        });

        it('should filter by status', async () => {
            enqueue([{ count: 5 }]);
            enqueue([]);
            const result = await archiveLendingService.findAll({ status: 'overdue' });
            expect(result.pagination.total).toBe(5);
        });
    });

    describe('findById', () => {
        it('should return record by id', async () => {
            enqueue([{ id: 'l1', status: 'borrowed' }]);
            const result = await archiveLendingService.findById('l1');
            expect(result).toEqual({ id: 'l1', status: 'borrowed' });
        });
    });

    describe('borrow', () => {
        it('should create lending for arsip with validation', async () => {
            // 1. Check existing arsip
            enqueue([{ id: 'a1', lendingStatus: 'available' }]);
            // 2. Insert lending record
            enqueue([{ id: 'l-new', status: 'borrowed', lendingType: 'arsip', arsipId: 'a1' }]);
            // 3. Update arsip.lendingStatus (void)

            const result = await archiveLendingService.borrow({
                lendingType: 'arsip', arsipId: 'a1',
                borrowerId: 'u1', borrowerName: 'John', dueDate: '2026-03-01',
            });
            expect(result.status).toBe('borrowed');
        });

        it('should reject if arsip not found', async () => {
            enqueue([]); // no arsip found
            await expect(archiveLendingService.borrow({
                lendingType: 'arsip', arsipId: 'nonexistent',
                borrowerId: 'u1', borrowerName: 'John', dueDate: '2026-03-01',
            })).rejects.toThrow('Arsip not found');
        });

        it('should reject if arsip already borrowed', async () => {
            enqueue([{ id: 'a1', lendingStatus: 'borrowed' }]);
            await expect(archiveLendingService.borrow({
                lendingType: 'arsip', arsipId: 'a1',
                borrowerId: 'u1', borrowerName: 'John', dueDate: '2026-03-01',
            })).rejects.toThrow('Arsip is already borrowed');
        });

        it('should reject arsip lending without arsipId', async () => {
            await expect(archiveLendingService.borrow({
                lendingType: 'arsip',
                borrowerId: 'u1', borrowerName: 'John', dueDate: '2026-03-01',
            })).rejects.toThrow('arsipId is required');
        });
    });

    describe('return', () => {
        it('should return borrowed item', async () => {
            // findById first
            enqueue([{ id: 'l1', status: 'borrowed', lendingType: 'arsip', arsipId: 'a1' }]);
            // update lending
            enqueue([{ id: 'l1', status: 'returned' }]);
            // update arsip status (void)
            const result = await archiveLendingService.return('l1', 'Good condition');
            expect(result.status).toBe('returned');
        });

        it('should throw if already returned', async () => {
            enqueue([{ id: 'l1', status: 'returned' }]);
            await expect(archiveLendingService.return('l1')).rejects.toThrow('Already returned');
        });

        it('should throw if not found', async () => {
            enqueue([]); // findById returns undefined
            await expect(archiveLendingService.return('nonexistent')).rejects.toThrow('Lending record not found');
        });
    });

    describe('extend', () => {
        it('should update due date', async () => {
            // extend calls this.findById first
            enqueue([{ id: 'l1', status: 'borrowed', dueDate: '2026-03-01' }]); // findById
            enqueue([{ id: 'l1', dueDate: '2026-04-01', status: 'borrowed' }]); // update returning
            const result = await archiveLendingService.extend('l1', '2026-04-01');
            expect(result.dueDate).toBe('2026-04-01');
        });
    });

    describe('getStats', () => {
        it('should return single-row statistics', async () => {
            // Single SQL query returning one row
            enqueue([{ total: 100, borrowed: 20, overdue: 5, returned: 75 }]);
            const result = await archiveLendingService.getStats();
            expect(result.total).toBe(100);
            expect(result.borrowed).toBe(20);
            expect(result.returned).toBe(75);
        });
    });

    describe('getHistoryByArsipId', () => {
        it('should return lending history for arsip', async () => {
            enqueue([
                { id: 'l1', arsipId: 'a1', status: 'returned' },
                { id: 'l2', arsipId: 'a1', status: 'borrowed' },
            ]);
            const result = await archiveLendingService.getHistoryByArsipId('a1');
            expect(result).toHaveLength(2);
        });
    });

    describe('getHistoryByLocationId', () => {
        it('should return lending history for location', async () => {
            enqueue([{ id: 'l1', storageLocationId: 'loc1' }]);
            const result = await archiveLendingService.getHistoryByLocationId('loc1');
            expect(result).toHaveLength(1);
        });
    });
});
