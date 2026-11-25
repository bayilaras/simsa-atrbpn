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

const { archiveLendingService } = await import('../services/archive-lending.service');

describe('ArchiveLendingService', () => {
    beforeEach(() => {
        resultQueue.length = 0;
        transactionCommits = 0;
        transactionRollbacks = 0;
        auditMocks.logActionOrThrow.mockReset();
        auditMocks.logActionOrThrow.mockResolvedValue(undefined);
    });

    describe('findAll', () => {
        it('should return paginated records', async () => {
            enqueue([{ count: 20 }]); // count query destructured: [{ count }]
            enqueue([{ lending: { id: 'l1', status: 'borrowed' }, borrower: { id: 'u1', name: 'John' } }]); // data with join
            const result = await archiveLendingService.findAll({ unitKerjaId: 'u1', page: 1, limit: 10 });
            expect(result.data).toHaveLength(1);
            expect(result.pagination.total).toBe(20);
            expect(result.pagination.totalPages).toBe(2);
        });

        it('should filter by status', async () => {
            enqueue([{ count: 5 }]);
            enqueue([]);
            const result = await archiveLendingService.findAll({ unitKerjaId: 'u1', status: 'overdue' });
            expect(result.pagination.total).toBe(5);
        });
    });

    describe('findById', () => {
        it('should return record by id', async () => {
            enqueue([{ id: 'l1', status: 'borrowed' }]);
            const result = await archiveLendingService.findById('l1', 'u1');
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
                borrowerId: 'u1', borrowerName: 'John', dueDate: '2099-03-01',
            }, 'u1', undefined, ['biasa']);
            expect(result.status).toBe('borrowed');
        });

        it('rolls back borrowing when critical audit storage fails', async () => {
            enqueue([{ id: 'a1', lendingStatus: 'available' }]);
            enqueue([{
                id: 'l-new', status: 'borrowed', lendingType: 'arsip', arsipId: 'a1',
                borrowerName: 'John', dueDate: '2099-03-01',
            }]);
            auditMocks.logActionOrThrow.mockRejectedValueOnce(new Error('audit unavailable'));

            await expect(archiveLendingService.borrow({
                lendingType: 'arsip', arsipId: 'a1',
                borrowerId: 'u1', borrowerName: 'John', dueDate: '2099-03-01',
            }, 'u1', { userId: 'u1' }, ['biasa'])).rejects.toThrow('audit unavailable');

            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
            expect(auditMocks.logActionOrThrow).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'create', entityType: 'archive_lending' }),
                mockDb,
            );
        });

        it('should reject if arsip not found', async () => {
            enqueue([]); // no arsip found
            await expect(archiveLendingService.borrow({
                lendingType: 'arsip', arsipId: 'nonexistent',
                borrowerId: 'u1', borrowerName: 'John', dueDate: '2099-03-01',
            }, 'u1')).rejects.toThrow('Arsip tidak ditemukan.');
        });

        it('should reject if arsip already borrowed', async () => {
            enqueue([{ id: 'a1', lendingStatus: 'borrowed' }]);
            await expect(archiveLendingService.borrow({
                lendingType: 'arsip', arsipId: 'a1',
                borrowerId: 'u1', borrowerName: 'John', dueDate: '2099-03-01',
            }, 'u1', undefined, ['biasa'])).rejects.toThrow('Arsip ini sedang dipinjam.');
        });

        it('answers an archive above the caller class ceiling like a missing one', async () => {
            enqueue([{ id: 'a1', lendingStatus: 'available', klasifikasiKeamanan: 'Rahasia' }]);
            await expect(archiveLendingService.borrow({
                lendingType: 'arsip', arsipId: 'a1',
                borrowerId: 'u1', borrowerName: 'John', dueDate: '2099-03-01',
            }, 'u1', { userId: 'u1' }, ['biasa', 'terbatas'])).rejects.toMatchObject({
                message: 'Arsip tidak ditemukan.', statusCode: 404,
            });
            expect(transactionRollbacks).toBe(1);
            expect(auditMocks.logActionOrThrow).not.toHaveBeenCalled();
        });

        it('does not treat a missing class policy as permission to lend', async () => {
            enqueue([{ id: 'a1', lendingStatus: 'available', klasifikasiKeamanan: 'biasa' }]);
            await expect(archiveLendingService.borrow({
                lendingType: 'arsip', arsipId: 'a1',
                borrowerId: 'u1', borrowerName: 'John', dueDate: '2099-03-01',
            }, 'u1')).rejects.toThrow('Arsip tidak ditemukan.');
        });

        it('accepts a due date of today and rejects yesterday at the WIB date boundary', async () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            // 16 September 00.30 WIB, masih 15 September menurut UTC.
            vi.setSystemTime(new Date('2026-09-15T17:30:00Z'));
            try {
                await expect(archiveLendingService.borrow({
                    lendingType: 'arsip', arsipId: 'a1',
                    borrowerId: 'u1', borrowerName: 'John', dueDate: '2026-09-15',
                }, 'u1', undefined, ['biasa'])).rejects.toMatchObject({
                    message: 'Jatuh tempo tidak boleh sebelum hari ini.', statusCode: 400,
                });
                expect(transactionCommits + transactionRollbacks).toBe(0);

                enqueue([{ id: 'a1', lendingStatus: 'available' }]);
                enqueue([{ id: 'l-new', status: 'borrowed', lendingType: 'arsip', arsipId: 'a1', dueDate: '2026-09-16' }]);
                const result = await archiveLendingService.borrow({
                    lendingType: 'arsip', arsipId: 'a1',
                    borrowerId: 'u1', borrowerName: 'John', dueDate: '2026-09-16',
                }, 'u1', undefined, ['biasa']);
                expect(result.dueDate).toBe('2026-09-16');
            } finally {
                vi.useRealTimers();
            }
        });

        it('should reject arsip lending without arsipId', async () => {
            await expect(archiveLendingService.borrow({
                lendingType: 'arsip',
                borrowerId: 'u1', borrowerName: 'John', dueDate: '2099-03-01',
            }, 'u1')).rejects.toThrow('Pilih arsip yang akan dipinjam.');
        });
    });

    describe('return', () => {
        it('should return borrowed item', async () => {
            // findById first
            enqueue([{ id: 'l1', status: 'borrowed', lendingType: 'arsip', arsipId: 'a1' }]);
            // update lending
            enqueue([{ id: 'l1', status: 'returned' }]);
            // update arsip status (void)
            const result = await archiveLendingService.return('l1', 'u1', 'Good condition');
            expect(result.status).toBe('returned');
        });

        it('should throw if already returned', async () => {
            enqueue([{ id: 'l1', status: 'returned' }]);
            await expect(archiveLendingService.return('l1', 'u1')).rejects.toThrow('Peminjaman ini sudah dikembalikan.');
        });

        it('should throw if not found', async () => {
            enqueue([]); // findById returns undefined
            await expect(archiveLendingService.return('nonexistent', 'u1')).rejects.toThrow('Data peminjaman tidak ditemukan.');
        });

        it('fails closed when the conditional return mutation loses the race', async () => {
            enqueue([{ id: 'l1', status: 'borrowed', lendingType: 'arsip', arsipId: 'a1' }]);
            enqueue([]); // status/unit predicate no longer matches

            await expect(archiveLendingService.return('l1', 'u1'))
                .rejects.toThrow('berubah sebelum pengembalian tersimpan');
        });
    });

    describe('extend', () => {
        it('should update due date', async () => {
            // extend calls this.findById first
            enqueue([{ id: 'l1', status: 'borrowed', dueDate: '2099-03-01' }]); // findById
            enqueue([{ id: 'l1', dueDate: '2099-04-01', status: 'borrowed' }]); // update returning
            const result = await archiveLendingService.extend('l1', 'u1', '2099-04-01');
            expect(result.dueDate).toBe('2099-04-01');
        });

        it('fails closed when the conditional extension mutation loses the race', async () => {
            enqueue([{ id: 'l1', status: 'borrowed', dueDate: '2099-03-01' }]);
            enqueue([]);

            await expect(archiveLendingService.extend('l1', 'u1', '2099-04-01'))
                .rejects.toThrow('berubah sebelum perpanjangan tersimpan');
        });

        it('rejects a new due date that is not later than the current one', async () => {
            for (const newDueDate of ['2099-03-01', '2099-02-28']) {
                enqueue([{ id: 'l1', status: 'borrowed', dueDate: '2099-03-01' }]);
                await expect(archiveLendingService.extend('l1', 'u1', newDueDate, { userId: 'u1' })).rejects.toMatchObject({
                    message: 'Jatuh tempo baru harus setelah jatuh tempo saat ini.', statusCode: 400,
                });
            }
            expect(auditMocks.logActionOrThrow).not.toHaveBeenCalled();
        });

        it('rejects a new due date before today (WIB) even for an overdue loan', async () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(new Date('2026-09-15T17:30:00Z'));
            try {
                await expect(archiveLendingService.extend('l1', 'u1', '2026-09-15')).rejects.toMatchObject({
                    message: 'Jatuh tempo tidak boleh sebelum hari ini.', statusCode: 400,
                });
                expect(transactionCommits + transactionRollbacks).toBe(0);

                enqueue([{ id: 'l1', status: 'borrowed', dueDate: '2026-09-01' }]);
                enqueue([{ id: 'l1', dueDate: '2026-09-16', status: 'borrowed' }]);
                expect((await archiveLendingService.extend('l1', 'u1', '2026-09-16')).dueDate).toBe('2026-09-16');
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('getStats', () => {
        it('should return single-row statistics', async () => {
            // Single SQL query returning one row
            enqueue([{ total: 100, borrowed: 20, overdue: 5, returned: 75 }]);
            const result = await archiveLendingService.getStats('u1');
            expect(result.total).toBe(100);
            expect(result.borrowed).toBe(20);
            expect(result.returned).toBe(75);
        });
    });

    describe('getHistoryByArsipId', () => {
        it('returns open loans and the returned history with its total', async () => {
            enqueue([{ id: 'a1', storageLocationId: null }]); // readable archive
            enqueue([{ id: 'l2', lendingType: 'arsip', status: 'borrowed', dueDate: '2099-03-01' }]); // open loans
            enqueue([{ count: 3 }]);
            enqueue([{ id: 'l1', lendingType: 'arsip', status: 'returned', dueDate: '2020-01-10' }]);
            const result = await archiveLendingService.getHistoryByArsipId('a1', 'u1', ['biasa'], 1);
            expect(result).toMatchObject({ readable: true, total: 3, limit: 1 });
            expect(result.active).toEqual([expect.objectContaining({ id: 'l2', status: 'borrowed', daysOverdue: 0 })]);
            expect(result.history).toEqual([expect.objectContaining({ id: 'l1', status: 'returned', daysOverdue: 0 })]);
        });

        it('answers an unreadable archive without looking up any loan', async () => {
            enqueue([]); // archive outside the unit or above the class ceiling
            enqueue([{ id: 'must-not-be-read' }]);
            const result = await archiveLendingService.getHistoryByArsipId('a1', 'u1', ['biasa']);
            expect(result).toEqual({ readable: false, active: [], history: [], total: 0, limit: 10 });
            expect(resultQueue).toHaveLength(1);
        });
    });

    describe('getHistoryByLocationId', () => {
        it('should return lending history for location', async () => {
            enqueue([{ id: 'l1', storageLocationId: 'loc1' }]);
            const result = await archiveLendingService.getHistoryByLocationId('loc1', 'u1');
            expect(result).toHaveLength(1);
        });
    });
});
