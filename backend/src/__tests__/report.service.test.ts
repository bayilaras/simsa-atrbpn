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
vi.mock('../services/archive-rule-assignment.service', () => ({
    RETENTION_GOVERNANCE_EVIDENCE_SELECT: {},
    CURRENT_RETENTION_TRIGGER_JOIN: {},
    CURRENT_RETENTION_VERIFICATION_JOIN: {},
    CURRENT_APPRAISAL_DECISION_JOIN: {},
    CURRENT_APPRAISAL_CASE_JOIN: {},
    archiveRuleAssignmentService: {
        evaluateCanonicalRetention: (triggerDate: string | null | undefined, evidence: any) => {
            const due = new Date();
            due.setDate(due.getDate() + 10);
            const dueIso = due.toISOString().slice(0, 10);
            const effectiveDispositionCode = evidence?.appraisalDecisionOutcome || 'musnah';
            return {
                verified: true,
                blockReason: null,
                calculationEligible: true,
                calculationBlockReason: null,
                normalizedRetention: {
                    activeMonths: 12,
                    inactiveMonths: 12,
                    calculationMode: 'duration',
                    dispositionCode: 'musnah',
                },
                dates: {
                    tanggalAktifBerakhir: triggerDate || null,
                    tanggalInaktifBerakhir: triggerDate ? dueIso : null,
                    tanggalKadaluarsa: triggerDate ? dueIso : null,
                },
                status: triggerDate ? 'akan_kadaluarsa' : 'belum_ditentukan',
                effectiveDispositionCode,
                effectiveDecisionSource: evidence?.appraisalDecisionOutcome ? 'appraisal' : 'jra',
                effectiveAppraisalDecisionId: evidence?.appraisalDecisionRecordId || null,
                dispositionEligible: false,
                dispositionBlockReason: 'masa retensi belum berakhir',
            };
        },
    },
}));

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
            // 4 DB calls: aggregation + canonical-retention rows + breakdowns
            enqueue([{ total: 500, masuk: 300, keluar: 150 }]);
            enqueue([]); // canonical-retention rows
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
            enqueue([
                { id: 'eligible', retentionTriggerDate: '2085-01-01', legalHold: false },
                { id: 'held', retentionTriggerDate: '2085-01-01', legalHold: true },
                { id: 'missing-trigger', retentionTriggerDate: null, legalHold: false },
            ]);
            enqueue([{ total: 3, masuk: 2, keluar: 1 }]);
            enqueue([]);
            enqueue([]);
            enqueue([]);

            const result = await reportService.getArsipReport({
                unitKerjaId: 'ditjen',
                type: 'expiring',
            });
            expect(result.data.map(item => item.id)).toEqual(['eligible']);
        });
    });

    describe('getArsipReport permanent', () => {
        it('uses the effective approved appraisal outcome instead of a legacy cache', async () => {
            enqueue([{
                id: 'appraised-permanent',
                retentionTriggerDate: '2020-01-01',
                legalHold: false,
                hasilAkhir: 'Musnah',
                appraisalDecisionOutcome: 'permanen',
                appraisalDecisionRecordId: 'decision-1',
            }]);
            enqueue([{ total: 1, masuk: 1, keluar: 0 }]);
            enqueue([]);
            enqueue([]);
            enqueue([]);

            const result = await reportService.getArsipReport({
                unitKerjaId: 'ditjen',
                type: 'permanent',
            });

            expect(result.data).toHaveLength(1);
            expect(result.data[0]).toMatchObject({
                id: 'appraised-permanent',
                hasilAkhir: 'Permanen',
            });
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
