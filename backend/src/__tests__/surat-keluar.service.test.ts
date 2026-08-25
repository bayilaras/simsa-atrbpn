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
    // create() uses db.transaction(async (tx) => { ... })
    transaction: async (cb: any) => {
        const txProxy: any = {
            select: (..._a: any[]) => mockChain,
            insert: (..._a: any[]) => mockChain,
            update: (..._a: any[]) => mockChain,
            delete: (..._a: any[]) => mockChain,
        };
        return cb(txProxy);
    },
};

vi.mock('../config/database', () => ({ db: mockDb }));

const { SuratKeluarService } = await import('../services/surat-keluar.service');

describe('SuratKeluarService', () => {
    let svc: InstanceType<typeof SuratKeluarService>;

    beforeEach(() => {
        svc = new SuratKeluarService();
        resultQueue.length = 0;
    });

    // ── findAll ──
    describe('findAll', () => {
        it('should return paginated results', async () => {
            enqueue([{ count: 15 }], [{ id: '1' }, { id: '2' }]);
            const res = await svc.findAll({ unitKerjaId: 'u1' });
            expect(res.data).toHaveLength(2);
            expect(res.pagination.total).toBe(15);
        });

        it('should calculate totalPages correctly', async () => {
            enqueue([{ count: 45 }], []);
            const res = await svc.findAll({ unitKerjaId: 'u1', page: 1, limit: 10 });
            expect(res.pagination.totalPages).toBe(5);
        });

        it('should handle all filter parameters', async () => {
            enqueue([{ count: 3 }], []);
            const res = await svc.findAll({
                unitKerjaId: 'u1',
                tahun: 2026,
                tanggalDari: '2026-01-01',
                tanggalSampai: '2026-12-31',
                naskahDinas: 'Surat Biasa',
            });
            expect(res.data).toEqual([]);
        });

        it('should return at least 1 totalPage even with 0 records', async () => {
            enqueue([{ count: 0 }], []);
            const res = await svc.findAll({ unitKerjaId: 'u1' });
            expect(res.pagination.totalPages).toBe(1);
        });
    });

    // ── findById ──
    describe('findById', () => {
        it('should return surat keluar when found', async () => {
            enqueue([{ id: '1', perihal: 'Test SK' }]);
            expect(await svc.findById('1', 'u1')).toEqual({ id: '1', perihal: 'Test SK' });
        });

        it('should return null when not found', async () => {
            enqueue([]);
            expect(await svc.findById('x', 'u1')).toBeNull();
        });

        it('should allow an explicit all-unit scope for super_admin callers', async () => {
            enqueue([{ id: '1', unitKerjaId: 'u2' }]);
            expect(await svc.findById('1', null)).toEqual({ id: '1', unitKerjaId: 'u2' });
        });
    });

    // ── create ──
    describe('create', () => {
        it('should auto-generate noUrut from last surat', async () => {
            enqueue([{ noUrut: 42 }]);   // lastSurat
            enqueue([{ id: 'new', noUrut: 43 }]); // insert returning
            const res = await svc.create({ unitKerjaId: 'u1', tahun: 2026 } as any);
            expect(res.noUrut).toBe(43);
        });

        it('should start at noUrut 1 for new unit/year', async () => {
            enqueue([]);  // no lastSurat
            enqueue([{ id: 'new', noUrut: 1 }]);
            const res = await svc.create({ unitKerjaId: 'u1', tahun: 2026 } as any);
            expect(res.noUrut).toBe(1);
        });

        it('should update surat masuk status when balasanUntuk is provided', async () => {
            enqueue([{ noUrut: 1 }]);     // lastSurat
            enqueue([{ id: 'sm-1' }]);    // same-unit reply target
            enqueue([{ id: 'reply-1', noUrut: 2, balasanUntuk: 'sm-1' }]); // insert
            enqueue([]);                   // update suratMasuk

            const res = await svc.create({
                unitKerjaId: 'u1',
                tahun: 2026,
                balasanUntuk: 'sm-1',
            } as any);
            expect(res.id).toBe('reply-1');
        });

        it('rejects a reply target outside the outgoing letter unit', async () => {
            enqueue([{ noUrut: 1 }]); // lastSurat
            enqueue([]);              // no live reply target in the same unit

            await expect(svc.create({
                unitKerjaId: 'u1',
                tahun: 2026,
                balasanUntuk: 'sm-other-unit',
            } as any)).rejects.toThrow('unit kerja yang sama');
        });
    });

    // ── update ──
    describe('update', () => {
        it('should update and return modified surat', async () => {
            enqueue([{ id: '1', perihal: 'Updated SK' }]);
            const res = await svc.update('1', { perihal: 'Updated SK' } as any, 'u1');
            expect(res).toEqual({ id: '1', perihal: 'Updated SK' });
        });
    });

    // ── delete ──
    describe('delete', () => {
        it('should delete and return deleted surat', async () => {
            enqueue([{ id: '1', perihal: 'To Delete' }]);
            const res = await svc.delete('1', undefined, 'u1');
            expect(res).toEqual({ id: '1', perihal: 'To Delete' });
        });
    });

    // ── archive ──
    describe('archive', () => {
        it('should call update with isArchived true', async () => {
            enqueue([{ id: '1', isArchived: true }]);
            const res = await svc.archive('1', 'u1');
            expect(res?.isArchived).toBe(true);
        });
    });

    // ── getNextNumber ──
    describe('getNextNumber', () => {
        it('should return next sequential number', async () => {
            enqueue([{ noUrut: 99 }]);
            expect(await svc.getNextNumber('u1', 2026)).toBe(100);
        });

        it('should return 1 when no surat exists for the year', async () => {
            enqueue([]);
            expect(await svc.getNextNumber('u1', 2026)).toBe(1);
        });

        it('should default to current year when tahun not provided', async () => {
            enqueue([]);
            expect(await svc.getNextNumber('u1')).toBe(1);
        });
    });

    // ── getStats ──
    describe('getStats', () => {
        it('should return statistics', async () => {
            const stats = { total: 20, diarsipkan: 5 };
            enqueue([stats]);
            expect(await svc.getStats('u1', 2026)).toEqual(stats);
        });

        it('should work without tahun filter', async () => {
            const stats = { total: 30, diarsipkan: 10 };
            enqueue([stats]);
            expect(await svc.getStats('u1')).toEqual(stats);
        });
    });
});
