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

const { dosirService } = await import('../services/dosir.service');

describe('DosirService', () => {
    beforeEach(() => { resultQueue.length = 0; });

    describe('create', () => {
        it('should create new dosir', async () => {
            enqueue([{ id: 'dosir-1', kode: 'D-001', judul: 'Test' }]);
            const result = await dosirService.create({
                unitKerjaId: 'u1', kode: 'D-001', judul: 'Test',
            });
            expect(result.kode).toBe('D-001');
        });
    });

    describe('update', () => {
        it('should update dosir details', async () => {
            enqueue([{ id: 'dosir-1', judul: 'Updated' }]);
            const result = await dosirService.update('dosir-1', { judul: 'Updated' });
            expect(result.judul).toBe('Updated');
        });
    });

    describe('delete', () => {
        it('should delete dosir and return success', async () => {
            // delete chain resolves via proxy
            const result = await dosirService.delete('dosir-1');
            expect(result).toEqual({ success: true });
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
            enqueue([{ dosirId: 'd1', suratMasukId: 'sm1' }]);
            const result = await dosirService.addSuratMasuk('d1', 'sm1');
            expect(result.dosirId).toBe('d1');
        });
    });

    describe('addSuratKeluar', () => {
        it('should link surat keluar to dosir', async () => {
            enqueue([{ dosirId: 'd1', suratKeluarId: 'sk1' }]);
            const result = await dosirService.addSuratKeluar('d1', 'sk1');
            expect(result.dosirId).toBe('d1');
        });
    });

    describe('removeSuratMasuk', () => {
        it('should unlink surat masuk from dosir', async () => {
            await expect(dosirService.removeSuratMasuk('d1', 'sm1')).resolves.not.toThrow();
        });
    });

    describe('removeSuratKeluar', () => {
        it('should unlink surat keluar from dosir', async () => {
            await expect(dosirService.removeSuratKeluar('d1', 'sk1')).resolves.not.toThrow();
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
            expect(result.total).toBe(50);
            expect(result.open).toBe(30);
            expect(result.closed).toBe(15);
            expect(result.archived).toBe(5);
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
