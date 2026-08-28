import { beforeEach, describe, expect, it, vi } from 'vitest';

const resultQueue: any[] = [];
function enqueue(...results: any[]) { resultQueue.push(...results); }

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const value = resultQueue.shift() ?? [];
            return (resolve: any) => resolve(value);
        }
        return (..._args: any[]) => mockChain;
    },
});

vi.mock('../config/database', () => ({
    db: {
        select: (..._args: any[]) => mockChain,
    },
}));
vi.mock('../services/arsip.service', () => ({
    arsipService: {
        evaluateCanonicalRetention: vi.fn((row: any) => row.evaluation || ({
            verified: false,
            blockReason: 'provenance atau pemicu belum terverifikasi',
            calculationEligible: false,
            calculationBlockReason: 'belum terverifikasi',
            normalizedRetention: null,
            dates: { tanggalAktifBerakhir: null, tanggalInaktifBerakhir: null, tanggalKadaluarsa: null },
            status: 'belum_ditentukan',
            effectiveDispositionCode: null,
            effectiveDecisionSource: null,
            effectiveAppraisalDecisionId: null,
            dispositionEligible: false,
            dispositionBlockReason: 'belum terverifikasi',
        })),
    },
}));

const { supervisionService } = await import('../services/supervision.service');

describe('SupervisionService retention compliance', () => {
    beforeEach(() => {
        resultQueue.length = 0;
    });

    it('returns retention safety and rule-quality statistics', async () => {
        const isoAfter = (days: number) => {
            const date = new Date();
            date.setUTCDate(date.getUTCDate() + days);
            return date.toISOString().slice(0, 10);
        };
        const evaluation = (expiry: string | null, outcome: string | null) => ({
            verified: true,
            blockReason: null,
            calculationEligible: true,
            calculationBlockReason: null,
            normalizedRetention: { dispositionCode: outcome || 'dinilai_kembali' },
            dates: { tanggalAktifBerakhir: null, tanggalInaktifBerakhir: expiry, tanggalKadaluarsa: expiry },
            status: expiry && expiry <= isoAfter(0) ? 'kadaluarsa' : 'akan_kadaluarsa',
            effectiveDispositionCode: outcome,
            effectiveDecisionSource: outcome ? 'jra' : null,
            effectiveAppraisalDecisionId: null,
            dispositionEligible: Boolean(outcome && expiry && expiry <= isoAfter(0)),
            dispositionBlockReason: outcome ? 'masa retensi belum berakhir' : 'appraisal diperlukan',
        });
        enqueue([
            { id: 'overdue', ruleProvenanceStatus: 'verified', jraItemId: 1, currentRetentionTriggerEventId: 'e1', legalHold: false, disposalStatus: 'active', jraRuleSetStatus: 'active', evaluation: evaluation(isoAfter(-1), 'musnah') },
            { id: 'legacy', ruleProvenanceStatus: 'legacy_unverified', jraItemId: 1, currentRetentionTriggerEventId: null, legalHold: true, disposalStatus: 'active', jraRuleSetStatus: 'superseded' },
            { id: 'pending', ruleProvenanceStatus: 'pending_jra', jraItemId: null, currentRetentionTriggerEventId: 'e2', legalHold: false, disposalStatus: 'active', jraRuleSetStatus: null },
            { id: 'manual', ruleProvenanceStatus: 'verified', jraItemId: 1, currentRetentionTriggerEventId: 'e3', legalHold: false, disposalStatus: 'active', jraRuleSetStatus: 'superseded', evaluation: evaluation(isoAfter(-1), null) },
            { id: 'due30', ruleProvenanceStatus: 'verified', jraItemId: 1, currentRetentionTriggerEventId: 'e4', legalHold: false, disposalStatus: 'active', jraRuleSetStatus: 'active', evaluation: evaluation(isoAfter(20), 'musnah') },
            { id: 'due90', ruleProvenanceStatus: 'verified', jraItemId: 1, currentRetentionTriggerEventId: 'e5', legalHold: false, disposalStatus: 'active', jraRuleSetStatus: 'active', evaluation: evaluation(isoAfter(60), 'musnah') },
        ]);
        enqueue([{ manualRules: 57 }]);
        enqueue([{ count: 1 }]); // unverified electronic archives
        enqueue([{ count: 3 }]); // new archives this month

        const result = await supervisionService.getComplianceStats();
        expect(result).toEqual({
            totalArchives: 6,
            verified: 4,
            verifiedCoveragePercent: 66.67,
            legacyUnverified: 1,
            pendingJra: 1,
            missingTriggerEvidence: 1,
            manualReviewBacklog: 1,
            legalHolds: 1,
            staleRuleVersion: 1,
            overdueRetention: 1,
            dueWithin30Days: 1,
            dueWithin90Days: 1,
            masterManualRules: 57,
            unverifiedElectronic: 1,
            newArchivesThisMonth: 3,
        });
    });

    it('labels every issue in the quality work queue', async () => {
        enqueue([{
            id: 'archive-1',
            nomorBerkas: 'B-1',
            uraianBerkas: 'Berkas uji',
            unitKerjaId: 'UNIT',
            ruleProvenanceStatus: 'legacy_unverified',
            retentionTriggerDate: null,
            retentionTriggerEvidence: null,
            tanggalKadaluarsa: null,
            legalHold: true,
            jraItemId: null,
            jraKode: null,
            jraDispositionCode: 'manual_review',
            jraCalculationMode: 'manual',
            jraRuleSetStatus: 'superseded',
            createdAt: new Date(),
        }]);

        const [result] = await supervisionService.getComplianceIssues();
        expect(result.issues).toEqual([
            'legacy_unverified',
            'pending_jra',
            'missing_trigger_evidence',
            'legal_hold',
            'stale_rule_version',
        ]);
    });
});
