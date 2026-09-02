import { db } from '../config/database';
import {
    auditLog,
    users,
    arsip,
    arsipRuleSnapshots,
    jadwalRetensiArsip,
    jraAppraisalCases,
    jraAppraisalDecisions,
    regulatoryRuleSets,
    retentionTriggerEvents,
    retentionTriggerVerifications,
} from '../db/schema';
import { eq, and, desc, sql, gte } from 'drizzle-orm';
import {
    CURRENT_APPRAISAL_CASE_JOIN,
    CURRENT_APPRAISAL_DECISION_JOIN,
    CURRENT_RETENTION_TRIGGER_JOIN,
    CURRENT_RETENTION_VERIFICATION_JOIN,
    RETENTION_GOVERNANCE_EVIDENCE_SELECT,
} from './archive-rule-assignment.service';
import { arsipService } from './arsip.service';

const SUPERVISION_RETENTION_SELECT = {
    id: arsip.id,
    nomorBerkas: arsip.nomorBerkas,
    uraianBerkas: arsip.uraianBerkas,
    unitKerjaId: arsip.unitKerjaId,
    ruleProvenanceStatus: arsip.ruleProvenanceStatus,
    currentRuleSnapshotId: arsip.currentRuleSnapshotId,
    currentRetentionTriggerEventId: arsip.currentRetentionTriggerEventId,
    currentAppraisalDecisionId: arsip.currentAppraisalDecisionId,
    retentionTriggerDate: arsip.retentionTriggerDate,
    retentionTriggerEvidence: arsip.retentionTriggerEvidence,
    tanggalKadaluarsa: arsip.tanggalKadaluarsa,
    legalHold: arsip.legalHold,
    disposalStatus: arsip.disposalStatus,
    jraItemId: arsip.jraItemId,
    jraRuleSetId: arsip.jraRuleSetId,
    jraKode: arsip.jraKode,
    retentionDecisionHash: arsip.retentionDecisionHash,
    ruleSnapshotId: arsipRuleSnapshots.id,
    ruleSnapshotArsipId: arsipRuleSnapshots.arsipId,
    ruleSnapshotStatus: arsipRuleSnapshots.status,
    ruleSnapshotJraItemId: arsipRuleSnapshots.jraItemId,
    ruleSnapshotJraRuleSetId: arsipRuleSnapshots.jraRuleSetId,
    ruleSnapshot: arsipRuleSnapshots.snapshot,
    ruleSnapshotSha256: arsipRuleSnapshots.snapshotSha256,
    jraRuleSetStatus: regulatoryRuleSets.status,
    createdAt: arsip.createdAt,
    updatedAt: arsip.updatedAt,
    ...RETENTION_GOVERNANCE_EVIDENCE_SELECT,
};

function retentionGovernanceJoins(query: any) {
    return query
        .leftJoin(arsipRuleSnapshots, and(
            eq(arsipRuleSnapshots.id, arsip.currentRuleSnapshotId),
            eq(arsipRuleSnapshots.arsipId, arsip.id),
        ))
        .leftJoin(retentionTriggerEvents, CURRENT_RETENTION_TRIGGER_JOIN)
        .leftJoin(retentionTriggerVerifications, CURRENT_RETENTION_VERIFICATION_JOIN)
        .leftJoin(jraAppraisalDecisions, CURRENT_APPRAISAL_DECISION_JOIN)
        .leftJoin(jraAppraisalCases, CURRENT_APPRAISAL_CASE_JOIN)
        .leftJoin(regulatoryRuleSets, eq(arsip.jraRuleSetId, regulatoryRuleSets.id));
}

export class SupervisionService {

    /**
     * Get daily activity stats for the last n days
     */
    async getActivityStats(days: number = 7) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - days);

        const stats = await db
            .select({
                date: sql<string>`to_char(${auditLog.createdAt}, 'YYYY-MM-DD')`,
                action: auditLog.action,
                count: sql<number>`count(*)::int`,
            })
            .from(auditLog)
            .where(gte(auditLog.createdAt, startDate))
            .groupBy(sql`to_char(${auditLog.createdAt}, 'YYYY-MM-DD')`, auditLog.action)
            .orderBy(sql`to_char(${auditLog.createdAt}, 'YYYY-MM-DD')`);

        // Pivot data for chart
        const dates = [...new Set(stats.map(s => s.date))].sort();
        const actions = ['create', 'update', 'delete', 'archive'];

        const chartData = dates.map(date => {
            const dayStats = stats.filter(s => s.date === date);
            const result: any = { date };
            actions.forEach(action => {
                const found = dayStats.find(s => s.action === action);
                result[action] = found?.count || 0;
            });
            return result;
        });

        return chartData;
    }

    /**
     * Get top active users
     */
    async getUserActivityStats(limit: number = 5) {
        const stats = await db
            .select({
                userId: auditLog.userId,
                userName: users.name,
                userEmail: users.email, // Fallback if name is null
                actionCount: sql<number>`count(*)::int`,
            })
            .from(auditLog)
            .leftJoin(users, eq(auditLog.userId, users.id))
            .groupBy(auditLog.userId, users.name, users.email)
            .orderBy(desc(sql`count(*)`))
            .limit(limit);

        return stats.map(s => ({
            ...s,
            userName: s.userName || s.userEmail || 'Unknown User'
        }));
    }

    /**
     * Get compliance statistics
     */
    async getComplianceStats() {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const in30Days = new Date(now);
        in30Days.setUTCDate(in30Days.getUTCDate() + 30);
        const in90Days = new Date(now);
        in90Days.setUTCDate(in90Days.getUTCDate() + 90);

        // Every operational metric is derived from the immutable rule snapshot,
        // current independently verified trigger and current effective appraisal.
        // Denormalized cache columns are not counted as authority.
        const archiveRows = await retentionGovernanceJoins(
            db.select(SUPERVISION_RETENTION_SELECT).from(arsip),
        );
        const in30DaysIso = in30Days.toISOString().split('T')[0];
        const in90DaysIso = in90Days.toISOString().split('T')[0];
        const quality = {
            totalArchives: archiveRows.length,
            verified: 0,
            legacyUnverified: 0,
            pendingJra: 0,
            missingTriggerEvidence: 0,
            manualReviewBacklog: 0,
            legalHolds: 0,
            staleRuleVersion: 0,
            overdueRetention: 0,
            dueWithin30Days: 0,
            dueWithin90Days: 0,
        };
        for (const row of archiveRows) {
            if (row.ruleProvenanceStatus === 'verified') quality.verified += 1;
            if (row.ruleProvenanceStatus === 'legacy_unverified') quality.legacyUnverified += 1;
            if (row.ruleProvenanceStatus === 'pending_jra' || !row.jraItemId) quality.pendingJra += 1;
            if (!row.currentRetentionTriggerEventId) quality.missingTriggerEvidence += 1;
            if (row.legalHold) quality.legalHolds += 1;
            if (row.ruleProvenanceStatus === 'verified' && row.jraRuleSetStatus !== 'active') {
                quality.staleRuleVersion += 1;
            }

            const evaluation = arsipService.evaluateCanonicalRetention(row);
            if (!evaluation.verified) continue;
            if (!evaluation.effectiveDispositionCode
                && (row.disposalStatus || 'active') === 'active') {
                quality.manualReviewBacklog += 1;
            }
            if (row.legalHold || (row.disposalStatus || 'active') !== 'active'
                || evaluation.effectiveDispositionCode !== 'musnah') continue;
            const expiry = evaluation.dates.tanggalKadaluarsa;
            if (!expiry) continue;
            if (expiry <= today) quality.overdueRetention += 1;
            else if (expiry <= in30DaysIso) quality.dueWithin30Days += 1;
            else if (expiry <= in90DaysIso) quality.dueWithin90Days += 1;
        }

        const [masterRules] = await db
            .select({
                manualRules: sql<number>`count(*) filter (where ${jadwalRetensiArsip.isSelectable} = true and ${jadwalRetensiArsip.dispositionCode} in ('manual_review', 'dinilai_kembali'))::int`,
            })
            .from(jadwalRetensiArsip)
            .innerJoin(
                regulatoryRuleSets,
                and(
                    eq(jadwalRetensiArsip.ruleSetId, regulatoryRuleSets.id),
                    eq(regulatoryRuleSets.status, 'active'),
                ),
            );

        // 2. Unverified Archives (if verification workflow exists)
        // Assuming 'status_verifikasi' or similar exists, or checking if verifiedBy is null
        // Based on previous tasks, we have 'statusVerifikasi' in 'arsip_elektronik'. 
        // For general arsip, let's check basic completeness or specific fields.
        // Let's use 'arsip_elektronik' for unverified count as strict verification is there.
        const { arsipElektronik } = await import('../db/schema/arsip-elektronik');

        const unverifiedElectronic = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(arsipElektronik)
            .where(eq(arsipElektronik.statusVerifikasi, 'pending'));

        // 3. Metadata Completeness (Example: missing optional but important fields like 'deskripsi' or 'box_number')
        // For now, let's count archives created this month
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const [newArchives] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(arsip)
            .where(gte(arsip.createdAt, startOfMonth));

        return {
            ...quality,
            verifiedCoveragePercent: quality.totalArchives
                ? Math.round(((quality.verified || 0) / quality.totalArchives) * 10000) / 100
                : 100,
            masterManualRules: masterRules?.manualRules || 0,
            unverifiedElectronic: unverifiedElectronic[0]?.count || 0,
            newArchivesThisMonth: newArchives?.count || 0,
        };
    }

    /**
     * Work queue behind the quality cards. It deliberately returns only
     * metadata needed for triage; document content remains behind normal
     * record-level access controls.
     */
    async getComplianceIssues(limit: number = 50) {
        const safeLimit = Math.max(1, Math.min(limit, 200));
        const now = new Date();
        const in90Days = new Date(now);
        in90Days.setUTCDate(in90Days.getUTCDate() + 90);
        const today = now.toISOString().slice(0, 10);
        const dueCutoff = in90Days.toISOString().slice(0, 10);

        const rows = await retentionGovernanceJoins(
            db.select(SUPERVISION_RETENTION_SELECT).from(arsip),
        ).orderBy(desc(arsip.updatedAt));

        return rows.flatMap((row: any) => {
            const issues: string[] = [];
            if (row.ruleProvenanceStatus === 'legacy_unverified') issues.push('legacy_unverified');
            if (row.ruleProvenanceStatus === 'pending_jra' || !row.jraItemId) issues.push('pending_jra');
            if (!row.currentRetentionTriggerEventId) issues.push('missing_trigger_evidence');
            const evaluation = arsipService.evaluateCanonicalRetention(row);
            if (!evaluation.verified
                && row.ruleProvenanceStatus === 'verified'
                && row.currentRetentionTriggerEventId) {
                issues.push('invalid_retention_governance');
            }
            if (evaluation.verified && !evaluation.effectiveDispositionCode) {
                issues.push('manual_review');
            }
            if (row.legalHold) issues.push('legal_hold');
            if (row.jraRuleSetStatus && row.jraRuleSetStatus !== 'active') issues.push('stale_rule_version');
            const expiry = evaluation.verified ? evaluation.dates.tanggalKadaluarsa : null;
            if (expiry && expiry >= today && expiry <= dueCutoff) issues.push('due_within_90_days');
            if (issues.length === 0) return [];
            return [{
                id: row.id,
                nomorBerkas: row.nomorBerkas,
                uraianBerkas: row.uraianBerkas,
                unitKerjaId: row.unitKerjaId,
                ruleProvenanceStatus: row.ruleProvenanceStatus,
                retentionTriggerDate: evaluation.verified ? row.triggerEventDate : null,
                retentionTriggerEvidence: evaluation.verified ? row.triggerEventEvidenceUri : null,
                tanggalKadaluarsa: expiry,
                legalHold: row.legalHold,
                jraItemId: row.jraItemId,
                jraKode: row.jraKode,
                jraDispositionCode: evaluation.normalizedRetention?.dispositionCode || null,
                effectiveDispositionCode: evaluation.effectiveDispositionCode,
                retentionBlockReason: evaluation.blockReason
                    || evaluation.dispositionBlockReason
                    || evaluation.calculationBlockReason,
                jraRuleSetStatus: row.jraRuleSetStatus,
                createdAt: row.createdAt,
                issues,
            }];
        }).slice(0, safeLimit);
    }
}

export const supervisionService = new SupervisionService();
