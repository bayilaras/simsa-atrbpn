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

const { reportService } = await import('../services/report.service');

describe('ReportService', () => {
    beforeEach(() => { resultQueue.length = 0; });

    // getSuratMasukReport internally calls getSuratMasukStats
    // getSuratMasukReport: countQuery + dataQuery
    // getSuratMasukStats: statsAggregation + monthlyBreakdown = 2 DB calls
    // Total: 2 + 2 = 4 queue items
    describe('getSuratMasukReport', () => {
        it('should return report with data, stats, and pagination', async () => {
            enqueue([{ count: 50 }]);  // report count
            enqueue([{ id: '1' }]);    // report data
            // getSuratMasukStats:
            enqueue([{ total: 100, belumDibalas: 60, sudahDibalas: 30, diarsipkan: 10 }]); // stats aggregation
            enqueue([{ month: 1, count: 50 }]); // monthly breakdown

            const result = await reportService.getSuratMasukReport({ unitKerjaId: 'ditjen', page: 1, limit: 20 });
            expect(result.data).toHaveLength(1);
            expect(result.pagination.total).toBe(50);
            expect(result.stats).toBeDefined();
            expect(result.stats.summary.total).toBe(100);
        });
    });

    describe('getSuratMasukStats', () => {
        it('should return aggregated surat masuk statistics', async () => {
            // 2 DB calls: aggregation + monthly
            enqueue([{ total: 100, belumDibalas: 60, sudahDibalas: 30, diarsipkan: 10 }]);
            enqueue([{ month: 1, count: 50 }]); // monthly

            const result = await reportService.getSuratMasukStats('ditjen');
            expect(result.summary.total).toBe(100);
            expect(result.summary.belumDibalas).toBe(60);
            expect(result.monthly).toHaveLength(12);
        });
    });

    describe('getSuratKeluarStats', () => {
        it('should return surat keluar statistics', async () => {
            // 2 DB calls: aggregation + monthly
            enqueue([{ total: 80, diarsipkan: 40 }]);
            enqueue([{ month: 1, count: 40 }]);

            const result = await reportService.getSuratKeluarStats('ditjen');
            expect(result.summary.total).toBe(80);
            expect(result.summary.diarsipkan).toBe(40);
            expect(result.monthly).toHaveLength(12);
        });
    });

    describe('getArsipStats', () => {
        it('should return arsip statistics', async () => {
            // 3 DB calls: aggregation + byClassification + byMediaType
            enqueue([{ total: 500, masuk: 300, keluar: 150, permanen: 50 }]);
            enqueue([{ kode: 'KU', count: 100 }]); // byClassification
            enqueue([{ mediaType: 'kertas', count: 400 }]); // byMediaType

            const result = await reportService.getArsipStats('ditjen');
            expect(result.summary.total).toBe(500);
            expect(result.summary.masuk).toBe(300);
            expect(result.byClassification).toHaveLength(1);
            expect(result.byMediaType).toHaveLength(1);
        });
    });

    describe('getArsipReport expiring', () => {
        it('excludes held and missing-trigger records from expiry reports', async () => {
            enqueue([{ count: 1 }]);
            enqueue([
                { id: 'eligible', retentionTriggerDate: '2085-01-01', legalHold: false },
                { id: 'held', retentionTriggerDate: '2085-01-01', legalHold: true },
                { id: 'missing-trigger', retentionTriggerDate: null, legalHold: false },
            ]);
            enqueue([{ total: 3, masuk: 2, keluar: 1, permanen: 0 }]);
            enqueue([]);
            enqueue([]);

            const result = await reportService.getArsipReport({
                unitKerjaId: 'ditjen',
                type: 'expiring',
            });
            expect(result.data.map(item => item.id)).toEqual(['eligible']);
        });
    });

    describe('getLendingStats', () => {
        it('should return lending statistics', async () => {
            enqueue([{ total: 100, borrowed: 20, overdue: 5, returned: 75 }]);
            enqueue([]); // overdue list

            const result = await reportService.getLendingStats();
            expect(result).toBeDefined();
        });
    });
});
