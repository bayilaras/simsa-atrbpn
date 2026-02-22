import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Chainable DB Mock ───
// Every method returns itself AND is awaitable via .then()
const resultQueue: any[] = [];
function enqueue(...results: any[]) { resultQueue.push(...results); }

// Create a fresh chain each time so Promise.all parallel queries work
function createChain(): any {
    return new Proxy({}, {
        get(_target, prop) {
            if (prop === 'then') {
                const val = resultQueue.shift() ?? [];
                return (resolve: any) => resolve(val);
            }
            return (..._args: any[]) => createChain();
        },
    });
}

const mockDb = {
    select: (..._a: any[]) => createChain(),
    insert: (..._a: any[]) => createChain(),
    update: (..._a: any[]) => createChain(),
    delete: (..._a: any[]) => createChain(),
    // create() uses db.transaction(async (tx) => { ... })
    // Execute the callback with a mock tx that uses the same chainable proxy
    transaction: async (cb: any) => {
        const txProxy: any = {
            select: (..._a: any[]) => createChain(),
            insert: (..._a: any[]) => createChain(),
            update: (..._a: any[]) => createChain(),
            delete: (..._a: any[]) => createChain(),
        };
        return cb(txProxy);
    },
};

vi.mock('../config/database', () => ({ db: mockDb }));

const { SuratMasukService } = await import('../services/surat-masuk.service');

describe('SuratMasukService', () => {
    let svc: InstanceType<typeof SuratMasukService>;

    beforeEach(() => {
        svc = new SuratMasukService();
        resultQueue.length = 0;
    });

    // ── findAll ──
    describe('findAll', () => {
        it('should return paginated data with default pagination', async () => {
            enqueue(
                [{ count: 2 }],             // countResult
                [{ id: '1' }, { id: '2' }], // data
            );
            const res = await svc.findAll({ unitKerjaId: 'u1' });
            expect(res.data).toHaveLength(2);
            expect(res.pagination.total).toBe(2);
            expect(res.pagination.page).toBe(1);
        });

        it('should apply custom page and limit', async () => {
            enqueue([{ count: 50 }], []);
            const res = await svc.findAll({ unitKerjaId: 'u1', page: 3, limit: 10 });
            expect(res.pagination.total).toBe(50);
            expect(res.pagination.totalPages).toBe(5);
            expect(res.pagination.page).toBe(3);
        });

        it('should return empty array when no data found', async () => {
            enqueue([{ count: 0 }], []);
            const res = await svc.findAll({ unitKerjaId: 'u1' });
            expect(res.data).toEqual([]);
            expect(res.pagination.total).toBe(0);
        });

        it('should handle filters correctly', async () => {
            enqueue([{ count: 1 }], [{ id: '1' }]);
            const res = await svc.findAll({
                unitKerjaId: 'u1',
                tahun: 2026,
                status: 'belum_dibalas',
                search: 'undangan',
            });
            expect(res.data).toHaveLength(1);
        });

        it('should handle null count result safely', async () => {
            enqueue([{ count: null }], []);
            const res = await svc.findAll({ unitKerjaId: 'u1' });
            expect(res.pagination.total).toBe(0);
        });
    });

    // ── findById ──
    describe('findById', () => {
        it('should return surat when found', async () => {
            enqueue([{ id: '1', perihal: 'Test' }]);
            const res = await svc.findById('1');
            expect(res).toEqual({ id: '1', perihal: 'Test' });
        });

        it('should return null when not found', async () => {
            enqueue([]);
            const res = await svc.findById('missing');
            expect(res).toBeNull();
        });
    });

    // ── create ──
    describe('create', () => {
        it('should auto-generate noUrut', async () => {
            // 1. select lastSurat
            enqueue([{ noUrut: 5 }]);
            // 2. insert().values().returning()
            enqueue([{ id: 'new', noUrut: 6 }]);

            const res = await svc.create({ unitKerjaId: 'u1', tahun: 2026 } as any);
            expect(res.noUrut).toBe(6);
        });

        it('should start noUrut at 1 when no previous surat exists', async () => {
            enqueue([]); // no lastSurat
            enqueue([{ id: 'new', noUrut: 1 }]);

            const res = await svc.create({ unitKerjaId: 'u1', tahun: 2026 } as any);
            expect(res.noUrut).toBe(1);
        });

        it('should default to current year when tahun not provided', async () => {
            enqueue([]);
            enqueue([{ id: 'new', noUrut: 1, tahun: new Date().getFullYear() }]);

            const res = await svc.create({ unitKerjaId: 'u1' } as any);
            expect(res.tahun).toBe(new Date().getFullYear());
        });
    });

    // ── update ──
    describe('update', () => {
        it('should update surat and return updated data', async () => {
            enqueue([{ id: '1', perihal: 'Updated' }]);
            const res = await svc.update('1', { perihal: 'Updated' } as any);
            expect(res).toEqual({ id: '1', perihal: 'Updated' });
        });

        it('should return undefined when surat not found', async () => {
            enqueue([]);
            const res = await svc.update('missing', {} as any);
            expect(res).toBeUndefined();
        });
    });

    // ── delete ──
    describe('delete', () => {
        it('should delete and return deleted surat', async () => {
            enqueue([{ id: '1', perihal: 'Deleted' }]);
            const res = await svc.delete('1');
            expect(res).toEqual({ id: '1', perihal: 'Deleted' });
        });

        it('should return undefined for nonexistent surat', async () => {
            enqueue([]);
            const res = await svc.delete('x');
            expect(res).toBeUndefined();
        });
    });

    // ── archive ──
    describe('archive', () => {
        it('should set isArchived to true', async () => {
            enqueue([{ id: '1', isArchived: true }]);
            const res = await svc.archive('1');
            expect(res?.isArchived).toBe(true);
        });
    });

    // ── getNextNumber ──
    describe('getNextNumber', () => {
        it('should return next sequential number', async () => {
            enqueue([{ noUrut: 99 }]);
            const res = await svc.getNextNumber('u1', 2026);
            expect(res).toBe(100);
        });

        it('should return 1 when no surat exists', async () => {
            enqueue([]);
            const res = await svc.getNextNumber('u1', 2026);
            expect(res).toBe(1);
        });
    });

    // ── getStats ──
    describe('getStats', () => {
        it('should return statistics for unit', async () => {
            // getStats uses Promise.all with 4 parallel count queries
            enqueue([{ count: 10 }]);  // total
            enqueue([{ count: 3 }]);   // belumDibalas
            enqueue([{ count: 5 }]);   // sudahDibalas
            enqueue([{ count: 2 }]);   // diarsipkan
            const res = await svc.getStats('u1', 2026);
            expect(res).toEqual({ total: 10, belumDibalas: 3, sudahDibalas: 5, diarsipkan: 2 });
        });
    });
});
