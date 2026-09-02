import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Chainable DB Mock ───
const resultQueue: any[] = [];
const whereCalls: any[] = [];
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
        return (...args: any[]) => {
            if (prop === 'where') whereCalls.push(args[0]);
            return mockChain;
        };
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

const { dosirService } = await import('../services/dosir.service');

describe('DosirService', () => {
    beforeEach(() => {
        resultQueue.length = 0;
        whereCalls.length = 0;
        transactionCommits = 0;
        transactionRollbacks = 0;
        auditMocks.logActionOrThrow.mockReset();
        auditMocks.logActionOrThrow.mockResolvedValue(undefined);
    });

    describe('create', () => {
        it('should create new dosir', async () => {
            enqueue([{ id: 'dosir-1', kode: 'D-001', judul: 'Test' }]);
            const result = await dosirService.create({
                unitKerjaId: 'u1', kode: 'D-001', judul: 'Test',
            });
            expect(result.kode).toBe('D-001');
        });

        it('rolls back dosir creation when critical audit storage fails', async () => {
            enqueue([{ id: 'dosir-1', kode: 'D-001', judul: 'Test' }]);
            auditMocks.logActionOrThrow.mockRejectedValueOnce(new Error('audit unavailable'));

            await expect(dosirService.create({
                unitKerjaId: 'u1', kode: 'D-001', judul: 'Test',
            }, { userId: 'user-1' })).rejects.toThrow('audit unavailable');

            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
        });
    });

    describe('update', () => {
        it('should update dosir details', async () => {
            enqueue(
                [{ id: 'dosir-1', judul: 'Before' }],
                [{ id: 'dosir-1', judul: 'Updated' }],
            );
            const result = await dosirService.update('dosir-1', { judul: 'Updated' }, 'u1');
            expect(result.judul).toBe('Updated');
        });
    });

    describe('delete', () => {
        it('should delete and return the unit-scoped dosir', async () => {
            enqueue(
                [{ id: 'dosir-1', unitKerjaId: 'u1' }],
                [{ id: 'dosir-1', unitKerjaId: 'u1' }],
            );
            const result = await dosirService.delete('dosir-1', 'u1');
            expect(result).toEqual({ id: 'dosir-1', unitKerjaId: 'u1' });
        });

        it('should return null when the scoped dosir is not found', async () => {
            enqueue([]);
            await expect(dosirService.delete('dosir-1', 'u2')).resolves.toBeNull();
        });
    });

    describe('getById', () => {
        it('should return a scoped dosir with linked surat', async () => {
            enqueue([{ id: 'd1', unitKerjaId: 'u1' }]);
            enqueue([{ link: { addedAt: 'now', notes: null }, surat: { id: 'sm1' } }]);
            enqueue([{ link: { addedAt: 'now', notes: null }, surat: { id: 'sk1' } }]);

            const result = await dosirService.getById('d1', 'u1');
            expect(result?.suratMasuk).toHaveLength(1);
            expect(result?.suratKeluar).toHaveLength(1);
        });

        it('should return null before loading links when the dosir is inaccessible', async () => {
            enqueue([]);
            await expect(dosirService.getById('d1', 'u2')).resolves.toBeNull();
        });
    });

    describe('getAccessMetadata', () => {
        it('returns scoped status metadata without loading linked surat', async () => {
            enqueue([{ id: 'd1', unitKerjaId: 'u1', status: 'open' }]);

            const result = await dosirService.getAccessMetadata(['d1', 'd1'], 'u1');

            expect(result).toEqual([{ id: 'd1', unitKerjaId: 'u1', status: 'open' }]);
            expect(resultQueue).toHaveLength(0);
        });

        it('does not query for an empty batch', async () => {
            await expect(dosirService.getAccessMetadata([], 'u1')).resolves.toEqual([]);
        });
    });

    describe('getAll', () => {
        it('should return results with surat counts', async () => {
            // Main query results
            enqueue([{ id: 'd1', judul: 'Test', kode: 'D-001' }]);
            // masukCounts
            enqueue([{ dosirId: 'd1', count: 3 }]);
            // keluarCounts
            enqueue([{ dosirId: 'd1', count: 2 }]);

            const result = await dosirService.getAll({ unitKerjaId: 'u1' });
            expect(whereCalls[0]).toBeDefined();
            expect(result).toHaveLength(1);
            expect(result[0].suratMasukCount).toBe(3);
            expect(result[0].suratKeluarCount).toBe(2);
            expect(result[0].totalSurat).toBe(5);
        });

        it('should handle empty results', async () => {
            enqueue([]); // no dosir
            // Should skip masuk/keluar counts for empty array
            const result = await dosirService.getAll({ status: 'aktif' });
            expect(result).toHaveLength(0);
        });
    });

    describe('addSuratMasuk', () => {
        it('should link surat masuk to dosir', async () => {
            enqueue([{ id: 'd1', unitKerjaId: 'u1' }]);
            enqueue([{ id: 'sm1' }]);
            enqueue([{ dosirId: 'd1', suratMasukId: 'sm1' }]);
            const result = await dosirService.addSuratMasuk('d1', 'sm1', undefined, 'u1');
            expect(result?.dosirId).toBe('d1');
        });

        it('should deny linking when the dosir is outside the unit scope', async () => {
            enqueue([]);
            await expect(
                dosirService.addSuratMasuk('d1', 'sm1', undefined, 'u2'),
            ).resolves.toBeNull();
        });
    });

    describe('addSuratKeluar', () => {
        it('should link surat keluar to dosir', async () => {
            enqueue([{ id: 'd1', unitKerjaId: 'u1' }]);
            enqueue([{ id: 'sk1' }]);
            enqueue([{ dosirId: 'd1', suratKeluarId: 'sk1' }]);
            const result = await dosirService.addSuratKeluar('d1', 'sk1', undefined, 'u1');
            expect(result?.dosirId).toBe('d1');
        });
    });

    describe('removeSuratMasuk', () => {
        it('should unlink surat masuk from dosir', async () => {
            enqueue([{ id: 'd1', unitKerjaId: 'u1' }]);
            enqueue([{ dosirId: 'd1' }]);
            await expect(dosirService.removeSuratMasuk('d1', 'sm1', 'u1')).resolves.not.toThrow();
        });
    });

    describe('removeSuratKeluar', () => {
        it('should unlink surat keluar from dosir', async () => {
            enqueue([{ id: 'd1', unitKerjaId: 'u1' }]);
            enqueue([{ dosirId: 'd1' }]);
            await expect(dosirService.removeSuratKeluar('d1', 'sk1', 'u1')).resolves.not.toThrow();
        });
    });

    describe('getStats', () => {
        it('should return dosir statistics with named fields', async () => {
            enqueue([
                { status: 'open', count: 30 },
                { status: 'closed', count: 15 },
                { status: 'archived', count: 5 },
            ]);
            const result = await dosirService.getStats('u1');
            expect(whereCalls).toHaveLength(1);
            expect(whereCalls[0]).toBeDefined();
            expect(result.total).toBe(50);
            expect(result.open).toBe(30);
            expect(result.closed).toBe(15);
            expect(result.archived).toBe(5);
        });

        it('uses an unfiltered aggregate only for an explicit all-unit scope', async () => {
            enqueue([{ status: 'open', count: 7 }]);

            const result = await dosirService.getStats(null);

            expect(whereCalls).toEqual([undefined]);
            expect(result).toEqual({ total: 7, open: 7, closed: 0, archived: 0 });
        });
    });

    describe('generateKode', () => {
        it('should generate next kode when no existing', async () => {
            enqueue([]); // no existing kodes
            const result = await dosirService.generateKode('u1');
            expect(result).toContain('u1-');
            expect(result).toContain('-001');
        });

        it('should increment from last existing kode', async () => {
            const year = new Date().getFullYear();
            enqueue([{ kode: `u1-${year}-005` }]);
            const result = await dosirService.generateKode('u1');
            expect(result).toContain('-006');
        });
    });
});
