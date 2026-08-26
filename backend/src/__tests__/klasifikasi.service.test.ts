import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// ─── Chainable DB Mock ───
const resultQueue: any[] = [];
const capturedWhere: any[] = [];
function enqueue(...results: any[]) { resultQueue.push(...results); }
const activeClassification = {
    id: '10102018-1010-4010-8010-000000000010',
    instrumentType: 'klasifikasi',
    status: 'active',
    version: 'ATR-BPN-10-2018',
    legalBasis: 'Permen ATR/BPN Nomor 10 Tahun 2018',
};
const activeJra = {
    id: '08002020-0800-4080-8080-000000000008',
    instrumentType: 'jra',
    status: 'active',
    version: 'ATR-BPN-8-2020',
    legalBasis: 'Permen ATR/BPN Nomor 8 Tahun 2020',
};

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const val = resultQueue.shift() ?? [];
            return (resolve: any) => resolve(val);
        }
        return (...args: any[]) => {
            if (prop === 'where') capturedWhere.push(args[0]);
            return mockChain;
        };
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
    beforeEach(() => { resultQueue.length = 0; capturedWhere.length = 0; });

    describe('getAll', () => {
        it('should return all items', async () => {
            enqueue([activeClassification], [
                { kode: 'KU', jenis: 'Keuangan', tipe: 'fasilitatif' },
                { kode: 'HK', jenis: 'Hukum', tipe: 'fasilitatif' },
            ]);
            const result = await klasifikasiService.getAll();
            expect(result).toHaveLength(2);
        });

        it('should filter by tipe', async () => {
            enqueue([activeClassification], [{ kode: 'KU', tipe: 'fasilitatif' }]);
            const result = await klasifikasiService.getAll({ tipe: 'fasilitatif' });
            expect(result).toHaveLength(1);
        });

        it('should filter active only', async () => {
            enqueue([activeClassification], [{ kode: 'KU', isActive: true }]);
            const result = await klasifikasiService.getAll({ activeOnly: true });
            expect(result).toHaveLength(1);
        });
    });

    describe('getTree', () => {
        it('should build tree from flat klasifikasi', async () => {
            enqueue([activeClassification], [
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
            enqueue([activeClassification], []);
            const result = await klasifikasiService.getTree();
            expect(result).toHaveLength(0);
        });
    });

    describe('getByKode', () => {
        it('should return item by kode', async () => {
            enqueue([activeClassification], [{ kode: 'KU', jenis: 'Keuangan' }]);
            const result = await klasifikasiService.getByKode('KU');
            expect(result.kode).toBe('KU');
        });

        it('should return null when not found', async () => {
            enqueue([activeClassification], []);
            const result = await klasifikasiService.getByKode('NONEXISTENT');
            expect(result).toBeNull();
        });
    });

    describe('create', () => {
        it('should create new klasifikasi', async () => {
            enqueue([{ ...activeClassification, status: 'draft' }], [{ kode: 'KU.03', jenis: 'Pajak' }]);
            const result = await klasifikasiService.create({
                ruleSetId: activeClassification.id,
                kode: 'KU.03',
                sourceRecordKey: 'test:1',
                jenis: 'Pajak',
            } as any);
            expect(result.kode).toBe('KU.03');
        });
    });

    describe('update', () => {
        it('should update klasifikasi', async () => {
            enqueue([{ ...activeClassification, status: 'draft' }], [{ kode: 'KU', jenis: 'Updated' }]);
            const result = await klasifikasiService.update('KU', {
                ruleSetId: activeClassification.id,
                jenis: 'Updated',
            } as any);
            expect(result.jenis).toBe('Updated');
        });
    });

    describe('delete (soft)', () => {
        it('should set isActive to false', async () => {
            enqueue([{ ...activeClassification, status: 'draft' }], [{ kode: 'KU', isActive: false }]);
            const result = await klasifikasiService.delete('KU', activeClassification.id);
            expect(result.isActive).toBe(false);
        });
    });

    describe('getStats', () => {
        it('should return statistics as object with totals', async () => {
            // getStats does db.select().from(klasifikasiArsip).where(isActive=true)
            // then counts by array length and filter
            enqueue([activeClassification], [
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
    beforeEach(() => { resultQueue.length = 0; capturedWhere.length = 0; });

    describe('getAll', () => {
        it('should return JRA items', async () => {
            enqueue([activeJra], [{ kode: 'F.I.01', uraian: 'Fasilitatif' }]);
            const result = await jraService.getAll();
            expect(result).toHaveLength(1);
        });
    });

    describe('getByKode', () => {
        it('should return JRA by kode', async () => {
            enqueue([activeJra], [{ kode: 'F.I.01' }]);
            const result = await jraService.getByKode('F.I.01');
            expect(result.kode).toBe('F.I.01');
        });
    });

    describe('create', () => {
        it('should create new JRA', async () => {
            enqueue([{ ...activeJra, status: 'draft' }], [{ kode: 'F.I.05', uraian: 'New JRA' }]);
            const result = await jraService.create({ ruleSetId: activeJra.id, kode: 'F.I.05' } as any);
            expect(result.kode).toBe('F.I.05');
        });
    });
});

describe('MappingService', () => {
    beforeEach(() => { resultQueue.length = 0; capturedWhere.length = 0; });

    describe('getAllMappings', () => {
        it('should return thematic mappings', async () => {
            enqueue(
                [activeClassification],
                [activeJra],
                [{ klasifikasiPrefix: 'KU', jraPrefix: 'F.I' }],
            );
            const result = await mappingService.getAllMappings();
            expect(result).toHaveLength(1);
        });
    });

    describe('getSuggestedJRA', () => {
        it('matches a complete JRA code segment so S.VI cannot include S.VII', async () => {
            enqueue(
                [activeClassification],
                [activeJra],
                [{ klasifikasiPrefix: 'PT', jraPrefix: 'S.VI', tema: 'Pengadaan Tanah' }],
                [{ id: 1, kode: 'S.VI.A.01', uraian: 'Pengadaan tanah' }],
            );

            const result = await mappingService.getSuggestedJRA('PT.01.01');

            expect(result.suggestedJRA).toHaveLength(1);
            const jraCondition = capturedWhere[capturedWhere.length - 1];
            const query = new PgDialect().sqlToQuery(jraCondition);
            expect(query.params).toContain('S.VI');
            expect(query.params).toContain('S.VI.%');
            expect(query.params).not.toContain('S.VI%');
        });
    });
});
