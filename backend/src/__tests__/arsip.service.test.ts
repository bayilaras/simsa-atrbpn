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

const { ArsipService } = await import('../services/arsip.service');

describe('ArsipService', () => {
    let svc: InstanceType<typeof ArsipService>;

    beforeEach(() => {
        svc = new ArsipService();
        resultQueue.length = 0;
    });

    // ── findAll ──
    describe('findAll', () => {
        it('should return paginated arsip data', async () => {
            enqueue(
                [{ count: 5 }],
                [{ id: '1' }, { id: '2' }],
            );
            const res = await svc.findAll({ unitKerjaId: 'u1' });
            expect(res.data).toHaveLength(2);
            expect(res.pagination.total).toBe(5);
        });

        it('should handle all filter parameters', async () => {
            enqueue([{ count: 1 }], [{ id: '1' }]);
            const res = await svc.findAll({
                unitKerjaId: 'u1',
                jenisArsip: 'masuk',
                tahun: 2026,
            });
            expect(res.data).toHaveLength(1);
        });

        it('should handle empty results', async () => {
            enqueue([{ count: 0 }], []);
            const res = await svc.findAll({ unitKerjaId: 'u1' });
            expect(res.data).toEqual([]);
            expect(res.pagination.total).toBe(0);
        });
    });

    // ── findById ──
    describe('findById', () => {
        it('should return arsip when found', async () => {
            enqueue([{ id: '1', jenisArsip: 'masuk' }]);
            expect(await svc.findById('1')).toEqual({ id: '1', jenisArsip: 'masuk' });
        });

        it('should return null when not found', async () => {
            enqueue([]);
            expect(await svc.findById('x')).toBeNull();
        });
    });

    // ── create ──
    describe('create', () => {
        it('should create arsip and return result', async () => {
            const newArsip = { id: 'a1', jenisArsip: 'masuk', unitKerjaId: 'u1' };
            enqueue([newArsip]);
            const res = await svc.create({ unitKerjaId: 'u1', jenisArsip: 'masuk' } as any);
            expect(res).toEqual(newArsip);
        });
    });

    // ── update ──
    describe('update', () => {
        it('should update and return arsip', async () => {
            enqueue([{ id: '1', keterangan: 'updated' }]);
            const res = await svc.update('1', { keterangan: 'updated' } as any);
            expect(res.keterangan).toBe('updated');
        });
    });

    // ── delete ──
    describe('delete', () => {
        it('should delete and return arsip', async () => {
            enqueue([{ id: '1' }]);
            const res = await svc.delete('1');
            expect(res).toEqual({ id: '1' });
        });
    });

    // ── Pure function: parseRetentionPeriod ──
    describe('parseRetentionPeriod', () => {
        it('should parse "2 tahun" to 2', () => {
            expect(svc.parseRetentionPeriod('2 tahun')).toBe(2);
        });

        it('should parse "5 Tahun" (case-insensitive)', () => {
            expect(svc.parseRetentionPeriod('5 Tahun')).toBe(5);
        });

        it('should parse "10 tahun"', () => {
            expect(svc.parseRetentionPeriod('10 tahun')).toBe(10);
        });

        it('should parse "1 tahun"', () => {
            expect(svc.parseRetentionPeriod('1 tahun')).toBe(1);
        });

        it('should return 0 for null', () => {
            expect(svc.parseRetentionPeriod(null)).toBe(0);
        });

        it('should return 0 for empty string', () => {
            expect(svc.parseRetentionPeriod('')).toBe(0);
        });

        it('should return 0 for invalid format', () => {
            expect(svc.parseRetentionPeriod('abc')).toBe(0);
        });
    });

    // ── Pure function: calculateRetentionDates ──
    describe('calculateRetentionDates', () => {
        it('should calculate active and inactive end dates', () => {
            const result = svc.calculateRetentionDates('2020-01-15', '2 tahun', '3 tahun');
            expect(result.tanggalAktifBerakhir).toBe('2022-01-15');
            expect(result.tanggalInaktifBerakhir).toBe('2025-01-15');
            expect(result.tanggalKadaluarsa).toBe('2025-01-15');
        });

        it('should handle null active retention', () => {
            const result = svc.calculateRetentionDates('2020-01-15', null, '5 tahun');
            expect(result.tanggalAktifBerakhir).toBeNull();
            expect(result.tanggalInaktifBerakhir).toBe('2025-01-15');
        });

        it('should handle both retentions as null', () => {
            const result = svc.calculateRetentionDates('2020-01-15', null, null);
            expect(result.tanggalAktifBerakhir).toBeNull();
            expect(result.tanggalInaktifBerakhir).toBeNull();
            expect(result.tanggalKadaluarsa).toBe('2020-01-15');
        });

        it('should handle only active retention (no inactive)', () => {
            const result = svc.calculateRetentionDates('2020-06-01', '3 tahun', null);
            expect(result.tanggalAktifBerakhir).toBe('2023-06-01');
            expect(result.tanggalInaktifBerakhir).toBe('2023-06-01');
            expect(result.tanggalKadaluarsa).toBe('2023-06-01');
        });
    });

    // ── Pure function: getArchiveStatus ──
    describe('getArchiveStatus', () => {
        it('should return "aktif" for archive within active period', () => {
            const farFuture = `${new Date().getFullYear() + 10}-01-01`;
            expect(svc.getArchiveStatus(farFuture, '20 tahun', '10 tahun')).toBe('aktif');
        });

        it('should return "kadaluarsa" for expired archive', () => {
            expect(svc.getArchiveStatus('2000-01-01', '1 tahun', '1 tahun')).toBe('kadaluarsa');
        });

        it('should return "inaktif" for archive in inactive period', () => {
            const twoYearsAgo = new Date();
            twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
            const dateStr = twoYearsAgo.toISOString().split('T')[0];
            expect(svc.getArchiveStatus(dateStr, '1 tahun', '10 tahun')).toBe('inaktif');
        });

        it('should return "aktif" when no active retention is set', () => {
            expect(svc.getArchiveStatus('2020-01-01', null, null)).toBe('aktif');
        });
    });

    // ── getStats ──
    describe('getStats', () => {
        it('should return archive statistics', async () => {
            const stats = { total: 100, arsipMasuk: 60, arsipKeluar: 40 };
            enqueue([stats]);
            expect(await svc.getStats('u1', 2026)).toEqual(stats);
        });

        it('should work without year filter', async () => {
            const stats = { total: 200, arsipMasuk: 120, arsipKeluar: 80 };
            enqueue([stats]);
            expect(await svc.getStats('u1')).toEqual(stats);
        });
    });
});
