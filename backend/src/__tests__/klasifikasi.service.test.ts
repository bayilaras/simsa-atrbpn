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

const { klasifikasiService, jraService, mappingService } = await import('../services/klasifikasi.service');

describe('KlasifikasiService', () => {
    beforeEach(() => { resultQueue.length = 0; });

    describe('getAll', () => {
        it('should return all items', async () => {
            enqueue([
                { kode: 'KU', jenis: 'Keuangan', tipe: 'fasilitatif' },
                { kode: 'HK', jenis: 'Hukum', tipe: 'fasilitatif' },
            ]);
            const result = await klasifikasiService.getAll();
            expect(result).toHaveLength(2);
        });

        it('should filter by tipe', async () => {
            enqueue([{ kode: 'KU', tipe: 'fasilitatif' }]);
            const result = await klasifikasiService.getAll({ tipe: 'fasilitatif' });
            expect(result).toHaveLength(1);
        });

        it('should filter active only', async () => {
            enqueue([{ kode: 'KU', isActive: true }]);
            const result = await klasifikasiService.getAll({ activeOnly: true });
            expect(result).toHaveLength(1);
        });
    });

    describe('getTree', () => {
        it('should build tree from flat klasifikasi', async () => {
            enqueue([
                { kode: 'KU', jenis: 'Keuangan', parentKode: null, tipe: 'fasilitatif', level: 1, isActive: true },
                { kode: 'KU.01', jenis: 'Anggaran', parentKode: 'KU', tipe: 'fasilitatif', level: 2, isActive: true },
                { kode: 'KU.02', jenis: 'Perbendaharaan', parentKode: 'KU', tipe: 'fasilitatif', level: 2, isActive: true },
                { kode: 'HK', jenis: 'Hukum', parentKode: null, tipe: 'fasilitatif', level: 1, isActive: true },
            ]);
            const result = await klasifikasiService.getTree();
            expect(result).toHaveLength(2);
            const ku = result.find((n: any) => n.kode === 'KU');
            expect(ku.children).toHaveLength(2);
        });

        it('should return empty tree when no items', async () => {
            enqueue([]);
            const result = await klasifikasiService.getTree();
            expect(result).toHaveLength(0);
        });
    });

    describe('getByKode', () => {
        it('should return item by kode', async () => {
            enqueue([{ kode: 'KU', jenis: 'Keuangan' }]);
            const result = await klasifikasiService.getByKode('KU');
            expect(result.kode).toBe('KU');
        });

        it('should return null when not found', async () => {
            enqueue([]);
            const result = await klasifikasiService.getByKode('NONEXISTENT');
            expect(result).toBeNull();
        });
    });

    describe('create', () => {
        it('should create new klasifikasi', async () => {
            enqueue([{ kode: 'KU.03', jenis: 'Pajak' }]);
            const result = await klasifikasiService.create({ kode: 'KU.03', jenis: 'Pajak' } as any);
            expect(result.kode).toBe('KU.03');
        });
    });

    describe('update', () => {
        it('should update klasifikasi', async () => {
            enqueue([{ kode: 'KU', jenis: 'Updated' }]);
            const result = await klasifikasiService.update('KU', { jenis: 'Updated' } as any);
            expect(result.jenis).toBe('Updated');
        });
    });

    describe('delete (soft)', () => {
        it('should set isActive to false', async () => {
            enqueue([{ kode: 'KU', isActive: false }]);
            const result = await klasifikasiService.delete('KU');
            expect(result.isActive).toBe(false);
        });
    });

    describe('getStats', () => {
        it('should return statistics as object with totals', async () => {
            // getStats does db.select().from(klasifikasiArsip).where(isActive=true)
            // then counts by array length and filter
            enqueue([
                { tipe: 'fasilitatif', level: 0, isActive: true },
                { tipe: 'fasilitatif', level: 1, isActive: true },
                { tipe: 'substantif', level: 0, isActive: true },
            ]);
            const result = await klasifikasiService.getStats();
            expect(result.total).toBe(3);
            expect(result.fasilitatif).toBe(2);
            expect(result.substantif).toBe(1);
            expect(result.rootFasilitatif).toBe(1);
            expect(result.rootSubstantif).toBe(1);
        });
    });
});

describe('JRAService', () => {
    beforeEach(() => { resultQueue.length = 0; });

    describe('getAll', () => {
        it('should return JRA items', async () => {
            enqueue([{ kode: 'F.I.01', uraian: 'Fasilitatif' }]);
            const result = await jraService.getAll();
            expect(result).toHaveLength(1);
        });
    });

    describe('getByKode', () => {
        it('should return JRA by kode', async () => {
            enqueue([{ kode: 'F.I.01' }]);
            const result = await jraService.getByKode('F.I.01');
            expect(result.kode).toBe('F.I.01');
        });
    });

    describe('create', () => {
        it('should create new JRA', async () => {
            enqueue([{ kode: 'F.I.05', uraian: 'New JRA' }]);
            const result = await jraService.create({ kode: 'F.I.05' } as any);
            expect(result.kode).toBe('F.I.05');
        });
    });
});

describe('MappingService', () => {
    beforeEach(() => { resultQueue.length = 0; });

    describe('getAllMappings', () => {
        it('should return thematic mappings', async () => {
            enqueue([{ klasifikasiPrefix: 'KU', jraPrefix: 'F.I' }]);
            const result = await mappingService.getAllMappings();
            expect(result).toHaveLength(1);
        });
    });
});
