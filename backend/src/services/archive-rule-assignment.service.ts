import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
    arsip,
    arsipRuleSnapshots,
    jadwalRetensiArsip,
    jraAppraisalCases,
    jraAppraisalDecisions,
    klasifikasiArsip,
    klasifikasiJraMapping,
    regulatoryRuleSets,
    retentionTriggerEvents,
    retentionTriggerVerifications,
} from '../db/schema';
import { ConflictError, ValidationError } from '../utils/errors';

export interface RuleSelectionInput {
    klasifikasiItemId?: number;
    kodeKlasifikasi?: string;
    jraItemId?: number;
    jraKode?: string;
}

export type ArchiveLifecycleStatus =
    | 'belum_ditentukan'
    | 'aktif'
    | 'akan_inaktif'
    | 'inaktif'
    | 'akan_kadaluarsa'
    | 'kadaluarsa';

export interface StructuredRetentionRule {
    activeMonths: number | null;
    inactiveMonths: number | null;
    calculationMode: string;
    dispositionCode: string;
    triggerGuidance?: string | null;
}

export interface CanonicalRetentionEvidence {
    arsipId?: string | null;
    ruleProvenanceStatus?: string | null;
    currentRuleSnapshotId?: string | null;
    jraItemId?: number | null;
    jraRuleSetId?: string | null;
    retentionDecisionHash?: string | null;
    snapshotId?: string | null;
    snapshotArsipId?: string | null;
    snapshotStatus?: string | null;
    snapshotJraItemId?: number | null;
    snapshotJraRuleSetId?: string | null;
    snapshot?: unknown;
    snapshotSha256?: string | null;
    currentRetentionTriggerEventId?: string | null;
    triggerEventRecordId?: string | null;
    triggerEventArsipId?: string | null;
    triggerEventType?: string | null;
    triggerEventLabel?: string | null;
    triggerEventDate?: string | null;
    triggerEventEvidenceUri?: string | null;
    triggerEventRevision?: number | null;
    triggerEventActorId?: string | null;
    triggerVerificationVerdict?: string | null;
    triggerVerifierId?: string | null;
    latestTriggerEventRevision?: number | null;
    currentAppraisalDecisionId?: string | null;
    appraisalDecisionRecordId?: string | null;
    appraisalDecisionArsipId?: string | null;
    appraisalDecisionStatus?: string | null;
    appraisalDecisionOutcome?: string | null;
    appraisalDecisionSnapshot?: unknown;
    appraisalDecisionSha256?: string | null;
    appraisalCaseStatus?: string | null;
    hasActiveAppraisalCase?: boolean | null;
}

export interface RetentionDates {
    tanggalAktifBerakhir: string | null;
    tanggalInaktifBerakhir: string | null;
    tanggalKadaluarsa: string | null;
}

export interface CanonicalRetentionEvaluation {
    verified: boolean;
    blockReason: string | null;
    calculationEligible: boolean;
    calculationBlockReason: string | null;
    normalizedRetention: StructuredRetentionRule | null;
    dates: RetentionDates;
    status: ArchiveLifecycleStatus;
    effectiveDispositionCode: string | null;
    effectiveDecisionSource: 'jra' | 'appraisal' | null;
    effectiveAppraisalDecisionId: string | null;
    dispositionEligible: boolean;
    dispositionBlockReason: string | null;
}

export const RETENTION_GOVERNANCE_EVIDENCE_SELECT = {
    triggerEventRecordId: retentionTriggerEvents.id,
    triggerEventArsipId: retentionTriggerEvents.arsipId,
    triggerEventType: retentionTriggerEvents.eventType,
    triggerEventLabel: retentionTriggerEvents.label,
    triggerEventDate: retentionTriggerEvents.eventDate,
    triggerEventEvidenceUri: retentionTriggerEvents.evidenceUri,
    triggerEventRevision: retentionTriggerEvents.revision,
    triggerEventActorId: retentionTriggerEvents.actorId,
    triggerVerificationVerdict: retentionTriggerVerifications.verdict,
    triggerVerifierId: retentionTriggerVerifications.verifierId,
    latestTriggerEventRevision: sql<number | null>`(
        SELECT max(latest_trigger.revision)::int
        FROM retention_trigger_events latest_trigger
        WHERE latest_trigger.arsip_id = ${arsip.id}
    )`,
    appraisalDecisionRecordId: jraAppraisalDecisions.id,
    appraisalDecisionArsipId: jraAppraisalDecisions.arsipId,
    appraisalDecisionStatus: jraAppraisalDecisions.decisionStatus,
    appraisalDecisionOutcome: jraAppraisalDecisions.outcome,
    appraisalDecisionSnapshot: jraAppraisalDecisions.decisionSnapshot,
    appraisalDecisionSha256: jraAppraisalDecisions.decisionSha256,
    appraisalCaseStatus: jraAppraisalCases.status,
    hasActiveAppraisalCase: sql<boolean>`EXISTS (
        SELECT 1 FROM jra_appraisal_cases active_appraisal
        WHERE active_appraisal.arsip_id = ${arsip.id}
          AND active_appraisal.status IN ('open', 'in_review')
    )`,
};

export const CURRENT_RETENTION_TRIGGER_JOIN = and(
    eq(retentionTriggerEvents.id, arsip.currentRetentionTriggerEventId),
    eq(retentionTriggerEvents.arsipId, arsip.id),
);
export const CURRENT_RETENTION_VERIFICATION_JOIN = eq(
    retentionTriggerVerifications.eventId,
    retentionTriggerEvents.id,
);
export const CURRENT_APPRAISAL_DECISION_JOIN = and(
    eq(jraAppraisalDecisions.id, arsip.currentAppraisalDecisionId),
    eq(jraAppraisalDecisions.arsipId, arsip.id),
);
export const CURRENT_APPRAISAL_CASE_JOIN = eq(
    jraAppraisalCases.id,
    jraAppraisalDecisions.caseId,
);

type Executor = any;

function canonicalJson(value: any): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function outcomeLabel(code: string | null | undefined): 'Musnah' | 'Permanen' | 'Dinilai Kembali' {
    if (code === 'musnah') return 'Musnah';
    if (code === 'permanen') return 'Permanen';
    return 'Dinilai Kembali';
}

function addMonths(dateValue: string, months: number): string {
    const date = new Date(`${dateValue}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new ValidationError('Tanggal pemicu retensi tidak valid.');
    const targetMonthStart = new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth() + months,
        1,
    ));
    const targetLastDay = new Date(Date.UTC(
        targetMonthStart.getUTCFullYear(),
        targetMonthStart.getUTCMonth() + 1,
        0,
    )).getUTCDate();
    const result = new Date(Date.UTC(
        targetMonthStart.getUTCFullYear(),
        targetMonthStart.getUTCMonth(),
        Math.min(date.getUTCDate(), targetLastDay),
    ));
    return result.toISOString().slice(0, 10);
}

const EMPTY_RETENTION_DATES: RetentionDates = {
    tanggalAktifBerakhir: null,
    tanggalInaktifBerakhir: null,
    tanggalKadaluarsa: null,
};

function isMonthCount(value: unknown): value is number {
    return Number.isInteger(value) && Number(value) >= 0;
}

function snapshotObject(value: unknown): Record<string, any> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : null;
}

function codeMatchesSegmentPrefix(code: string, prefix: string): boolean {
    const normalizedCode = code.trim();
    const normalizedPrefix = prefix.trim();
    return normalizedPrefix.length > 0
        && (normalizedCode === normalizedPrefix
            || normalizedCode.startsWith(`${normalizedPrefix}.`));
}

export class ArchiveRuleAssignmentService {
    async resolveActive(executor: Executor, input: RuleSelectionInput) {
        const classificationConditions = [
            eq(regulatoryRuleSets.instrumentType, 'klasifikasi'),
            eq(regulatoryRuleSets.status, 'active'),
            eq(klasifikasiArsip.isActive, true),
            eq(klasifikasiArsip.isSelectable, true),
            eq(klasifikasiArsip.organizationalScope, 'kementerian'),
        ];
        if (input.klasifikasiItemId) {
            classificationConditions.push(eq(klasifikasiArsip.id, input.klasifikasiItemId));
        } else if (input.kodeKlasifikasi?.trim()) {
            classificationConditions.push(eq(klasifikasiArsip.kode, input.kodeKlasifikasi.trim()));
        } else {
            throw new ValidationError('Pilih klasifikasi arsip dari versi peraturan yang aktif.');
        }

        const classificationMatches = await executor
            .select({ item: klasifikasiArsip, ruleSet: regulatoryRuleSets })
            .from(klasifikasiArsip)
            .innerJoin(regulatoryRuleSets, eq(klasifikasiArsip.ruleSetId, regulatoryRuleSets.id))
            .where(and(...classificationConditions))
            .limit(input.klasifikasiItemId ? 1 : 2);
        const [classification] = classificationMatches;
        if (!classification) {
            throw new ConflictError('Klasifikasi tidak ditemukan pada versi aktif atau bukan kode yang dapat dipilih. Muat ulang master data.');
        }
        if (!input.klasifikasiItemId && classificationMatches.length > 1) {
            throw new ConflictError('Kode klasifikasi memiliki lebih dari satu butir resmi. Pilih butir klasifikasi dari daftar agar identitas sumbernya tercatat.');
        }
        if (input.klasifikasiItemId && input.kodeKlasifikasi?.trim()
            && classification.item.kode !== input.kodeKlasifikasi.trim()) {
            throw new ValidationError(
                'ID butir klasifikasi tidak cocok dengan kode klasifikasi yang dikirim.',
            );
        }

        const retentionConditions = [
            eq(regulatoryRuleSets.instrumentType, 'jra'),
            eq(regulatoryRuleSets.status, 'active'),
            eq(jadwalRetensiArsip.isActive, true),
            eq(jadwalRetensiArsip.isSelectable, true),
        ];
        if (input.jraItemId) {
            retentionConditions.push(eq(jadwalRetensiArsip.id, input.jraItemId));
        } else if (input.jraKode?.trim()) {
            retentionConditions.push(eq(jadwalRetensiArsip.kode, input.jraKode.trim()));
        } else {
            throw new ValidationError('Pilih JRA dari versi peraturan yang aktif.');
        }

        const [retention] = await executor
            .select({ item: jadwalRetensiArsip, ruleSet: regulatoryRuleSets })
            .from(jadwalRetensiArsip)
            .innerJoin(regulatoryRuleSets, eq(jadwalRetensiArsip.ruleSetId, regulatoryRuleSets.id))
            .where(and(...retentionConditions))
            .limit(1);
        if (!retention) {
            throw new ConflictError('JRA tidak ditemukan pada versi aktif atau bukan jadwal yang dapat dipilih. Muat ulang master data.');
        }
        if (input.jraItemId && input.jraKode?.trim()
            && retention.item.kode !== input.jraKode.trim()) {
            throw new ValidationError('ID butir JRA tidak cocok dengan kode JRA yang dikirim.');
        }

        // The mapping endpoint is only a picker aid. Registration and rule
        // reconciliation must independently enforce the exact, version-bound
        // thematic pair on the server. A more-specific classification prefix
        // (for example TU.02) overrides its broader root (TU).
        const mappings = await executor
            .select()
            .from(klasifikasiJraMapping)
            .where(and(
                eq(klasifikasiJraMapping.klasifikasiRuleSetId, classification.ruleSet.id),
                eq(klasifikasiJraMapping.jraRuleSetId, retention.ruleSet.id),
                eq(klasifikasiJraMapping.isActive, true),
            ));
        const classificationMappings = mappings.filter((mapping: any) =>
            codeMatchesSegmentPrefix(classification.item.kode, mapping.klasifikasiPrefix),
        );
        if (classificationMappings.length === 0) {
            throw new ConflictError(
                `Pemetaan Klasifikasi-JRA aktif untuk ${classification.item.kode} tidak ditemukan pada pasangan versi peraturan yang dipublikasikan.`,
            );
        }
        const mostSpecificLength = Math.max(...classificationMappings.map((mapping: any) =>
            mapping.klasifikasiPrefix.trim().length,
        ));
        const applicableMappings = classificationMappings.filter((mapping: any) =>
            mapping.klasifikasiPrefix.trim().length === mostSpecificLength,
        );
        const selectedMapping = applicableMappings
            .filter((mapping: any) =>
                codeMatchesSegmentPrefix(retention.item.kode, mapping.jraPrefix),
            )
            .sort((left: any, right: any) =>
                right.jraPrefix.trim().length - left.jraPrefix.trim().length,
            )[0];
        if (!selectedMapping) {
            const allowedPrefixes = [...new Set(applicableMappings.map((mapping: any) =>
                mapping.jraPrefix,
            ))].join(', ');
            throw new ValidationError(
                `Butir JRA ${retention.item.kode} tidak sesuai dengan klasifikasi ${classification.item.kode}. Gunakan JRA pada prefix: ${allowedPrefixes}.`,
            );
        }

        const snapshot = {
            schemaVersion: 1,
            mapping: {
                id: selectedMapping.id,
                klasifikasiRuleSetId: selectedMapping.klasifikasiRuleSetId,
                jraRuleSetId: selectedMapping.jraRuleSetId,
                klasifikasiPrefix: selectedMapping.klasifikasiPrefix,
                jraPrefix: selectedMapping.jraPrefix,
                tema: selectedMapping.tema,
            },
            classification: {
                itemId: classification.item.id,
                ruleSetId: classification.ruleSet.id,
                version: classification.ruleSet.version,
                legalBasis: classification.ruleSet.legalBasis,
                sourceDocumentSha256: classification.ruleSet.sourceDocumentSha256,
                code: classification.item.kode,
                sourceCode: classification.item.sourceCode,
                sourceRecordKey: classification.item.sourceRecordKey,
                organizationalScope: classification.item.organizationalScope,
                title: classification.item.jenis,
                description: classification.item.keterangan,
                type: classification.item.tipe,
                parentCode: classification.item.parentKode,
                contentHash: classification.item.contentHash,
                sourcePage: classification.item.sourcePage,
            },
            retention: {
                itemId: retention.item.id,
                ruleSetId: retention.ruleSet.id,
                version: retention.ruleSet.version,
                legalBasis: retention.ruleSet.legalBasis,
                sourceDocumentSha256: retention.ruleSet.sourceDocumentSha256,
                code: retention.item.kode,
                title: retention.item.uraian,
                activeText: retention.item.retensiAktif,
                inactiveText: retention.item.retensiInaktif,
                activeMonths: retention.item.activeMonths,
                inactiveMonths: retention.item.inactiveMonths,
                calculationMode: retention.item.calculationMode,
                dispositionCode: retention.item.dispositionCode,
                dispositionText: retention.item.keterangan,
                triggerGuidance: retention.item.triggerGuidance,
                contentHash: retention.item.contentHash,
                sourcePage: retention.item.sourcePage,
            },
        };

        const classificationSnapshotHash = sha256(snapshot.classification);
        const retentionDecisionHash = sha256(snapshot.retention);
        const snapshotSha256 = sha256(snapshot);

        return {
            snapshot,
            snapshotSha256,
            cache: {
                kodeKlasifikasi: classification.item.kode,
                klasifikasiArsipId: classification.item.id,
                klasifikasiRuleSetId: classification.ruleSet.id,
                klasifikasiVersion: classification.ruleSet.version,
                klasifikasiReference: classification.ruleSet.legalBasis,
                klasifikasiSnapshotHash: classificationSnapshotHash,
                jraKode: retention.item.kode,
                jraItemId: retention.item.id,
                jraRuleSetId: retention.ruleSet.id,
                jraUraian: retention.item.uraian,
                retensiAktif: retention.item.retensiAktif,
                retensiInaktif: retention.item.retensiInaktif,
                retensiKeterangan: retention.item.keterangan,
                masaSimpanAktif: retention.item.retensiAktif,
                masaSimpanInaktif: retention.item.retensiInaktif,
                hasilAkhir: outcomeLabel(retention.item.dispositionCode),
                jraVersion: retention.ruleSet.version,
                jraReference: retention.ruleSet.legalBasis,
                retentionDecisionHash,
                ruleProvenanceStatus: 'verified' as const,
            },
            normalizedRetention: {
                activeMonths: retention.item.activeMonths,
                inactiveMonths: retention.item.inactiveMonths,
                calculationMode: retention.item.calculationMode,
                dispositionCode: retention.item.dispositionCode,
                triggerGuidance: retention.item.triggerGuidance,
            },
        };
    }

    calculateExpiry(
        triggerDate: string | null | undefined,
        normalized: StructuredRetentionRule,
    ): string | null {
        return this.calculateRetentionDates(triggerDate, normalized).tanggalKadaluarsa;
    }

    /**
     * Calculate lifecycle dates exclusively from normalized numeric values
     * captured in the immutable rule snapshot. Text such as "1 tahun" is a
     * display label and is deliberately never parsed here.
     */
    calculateRetentionDates(
        triggerDate: string | null | undefined,
        normalized: StructuredRetentionRule | null | undefined,
    ): RetentionDates {
        if (!triggerDate || !normalized) return { ...EMPTY_RETENTION_DATES };
        if (normalized.calculationMode !== 'duration') return { ...EMPTY_RETENTION_DATES };
        if (!isMonthCount(normalized.activeMonths) || !isMonthCount(normalized.inactiveMonths)) {
            return { ...EMPTY_RETENTION_DATES };
        }

        const tanggalAktifBerakhir = addMonths(triggerDate, normalized.activeMonths);
        const tanggalInaktifBerakhir = addMonths(tanggalAktifBerakhir, normalized.inactiveMonths);
        return {
            tanggalAktifBerakhir,
            tanggalInaktifBerakhir,
            tanggalKadaluarsa: tanggalInaktifBerakhir,
        };
    }

    getArchiveStatus(
        triggerDate: string | null | undefined,
        normalized: StructuredRetentionRule | null | undefined,
        now = new Date(),
    ): ArchiveLifecycleStatus {
        if (!triggerDate) return 'belum_ditentukan';

        const dates = this.calculateRetentionDates(triggerDate, normalized);
        if (!dates.tanggalKadaluarsa) return 'aktif';

        const today = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
        ));
        const activeEnd = new Date(`${dates.tanggalAktifBerakhir}T00:00:00.000Z`);
        const inactiveEnd = new Date(`${dates.tanggalInaktifBerakhir}T00:00:00.000Z`);
        const thirtyDaysFromNow = new Date(today);
        thirtyDaysFromNow.setUTCDate(thirtyDaysFromNow.getUTCDate() + 30);

        if (today > inactiveEnd) return 'kadaluarsa';
        if (today > activeEnd && inactiveEnd <= thirtyDaysFromNow) return 'akan_kadaluarsa';
        if (today > activeEnd) return 'inaktif';
        if (activeEnd <= thirtyDaysFromNow) return 'akan_inaktif';
        return 'aktif';
    }

    /**
     * Verify that a current snapshot is the exact source of the cached JRA
     * decision, then return its normalized retention fields. Any broken link,
     * hash mismatch, or non-duration rule fails closed and cannot become an
     * automated disposition candidate.
     */
    evaluateCanonicalRetention(
        triggerDate: string | null | undefined,
        evidence: CanonicalRetentionEvidence,
        now = new Date(),
    ): CanonicalRetentionEvaluation {
        const blocked = (reason: string): CanonicalRetentionEvaluation => ({
            verified: false,
            blockReason: reason,
            calculationEligible: false,
            calculationBlockReason: reason,
            normalizedRetention: null,
            dates: { ...EMPTY_RETENTION_DATES },
            status: triggerDate ? 'aktif' : 'belum_ditentukan',
            effectiveDispositionCode: null,
            effectiveDecisionSource: null,
            effectiveAppraisalDecisionId: null,
            dispositionEligible: false,
            dispositionBlockReason: reason,
        });

        if (evidence.ruleProvenanceStatus !== 'verified') {
            return blocked('provenance aturan arsip belum terverifikasi');
        }
        if (!evidence.currentRuleSnapshotId || evidence.snapshotId !== evidence.currentRuleSnapshotId) {
            return blocked('snapshot JRA saat ini tidak ditemukan atau penunjuk snapshot tidak cocok');
        }
        if (evidence.snapshotStatus !== 'verified') {
            return blocked('snapshot JRA belum terverifikasi');
        }
        if (evidence.arsipId && evidence.snapshotArsipId !== evidence.arsipId) {
            return blocked('snapshot JRA bukan milik arsip ini');
        }
        if (!evidence.snapshot || !evidence.snapshotSha256
            || sha256(evidence.snapshot) !== evidence.snapshotSha256) {
            return blocked('hash snapshot JRA tidak valid');
        }

        const snapshot = snapshotObject(evidence.snapshot);
        const retention = snapshotObject(snapshot?.retention);
        if (!snapshot || snapshot.schemaVersion !== 1 || !retention) {
            return blocked('struktur snapshot JRA tidak didukung');
        }
        if (!evidence.retentionDecisionHash
            || sha256(retention) !== evidence.retentionDecisionHash) {
            return blocked('hash keputusan retensi tidak cocok dengan snapshot');
        }

        if (!evidence.currentRetentionTriggerEventId
            || evidence.triggerEventRecordId !== evidence.currentRetentionTriggerEventId) {
            return blocked('peristiwa pemicu retensi terverifikasi belum ditetapkan');
        }
        if (evidence.arsipId && evidence.triggerEventArsipId !== evidence.arsipId) {
            return blocked('peristiwa pemicu retensi bukan milik arsip ini');
        }
        if (evidence.triggerVerificationVerdict !== 'verified'
            || !evidence.triggerVerifierId
            || evidence.triggerVerifierId === evidence.triggerEventActorId) {
            return blocked('peristiwa pemicu retensi belum diverifikasi secara independen');
        }
        if (!Number.isInteger(evidence.triggerEventRevision)
            || evidence.triggerEventRevision !== evidence.latestTriggerEventRevision) {
            return blocked('peristiwa pemicu retensi bukan revisi terbaru');
        }
        if (!evidence.triggerEventDate || triggerDate !== evidence.triggerEventDate) {
            return blocked('tanggal pemicu retensi tidak cocok dengan peristiwa terverifikasi');
        }

        const itemId = Number(retention.itemId);
        const ruleSetId = String(retention.ruleSetId || '');
        if (!Number.isInteger(itemId) || itemId <= 0 || !ruleSetId) {
            return blocked('identitas butir JRA pada snapshot tidak lengkap');
        }
        if (evidence.jraItemId !== itemId || evidence.snapshotJraItemId !== itemId
            || evidence.jraRuleSetId !== ruleSetId || evidence.snapshotJraRuleSetId !== ruleSetId) {
            return blocked('identitas butir JRA tidak konsisten dengan snapshot');
        }

        const activeMonths = retention.activeMonths;
        const inactiveMonths = retention.inactiveMonths;
        if (activeMonths !== null && !isMonthCount(activeMonths)) {
            return blocked('durasi aktif terstruktur pada snapshot tidak valid');
        }
        if (inactiveMonths !== null && !isMonthCount(inactiveMonths)) {
            return blocked('durasi inaktif terstruktur pada snapshot tidak valid');
        }
        const calculationMode = String(retention.calculationMode || '');
        const dispositionCode = String(retention.dispositionCode || '');
        if (!calculationMode || !dispositionCode) {
            return blocked('mode perhitungan atau hasil akhir JRA tidak lengkap');
        }
        if (!['duration', 'manual'].includes(calculationMode)) {
            return blocked('mode perhitungan JRA pada snapshot tidak dikenal');
        }
        if (!['musnah', 'permanen', 'dinilai_kembali', 'manual_review'].includes(dispositionCode)) {
            return blocked('hasil akhir JRA pada snapshot tidak dikenal');
        }

        const normalizedRetention: StructuredRetentionRule = {
            activeMonths,
            inactiveMonths,
            calculationMode,
            dispositionCode,
            triggerGuidance: retention.triggerGuidance ?? null,
        };
        // A duration may still be calculated for "Dinilai kembali". The date
        // calculation and authority to dispose are separate decisions: only a
        // current approved appraisal may turn that outcome into Musnah or
        // Permanen.
        const requiresHumanAppraisal = calculationMode === 'manual'
            || ['dinilai_kembali', 'manual_review'].includes(dispositionCode);
        const calculationEligible = calculationMode === 'duration'
            && isMonthCount(activeMonths)
            && isMonthCount(inactiveMonths);
        const calculationBlockReason = calculationEligible
            ? null
            : calculationMode !== 'duration'
                ? `mode perhitungan JRA ${calculationMode} memerlukan penilaian manusia`
                : 'durasi aktif/inaktif terstruktur belum lengkap';
        const dates = calculationEligible
            ? this.calculateRetentionDates(triggerDate, normalizedRetention)
            : { ...EMPTY_RETENTION_DATES };
        const status = calculationEligible
            ? this.getArchiveStatus(triggerDate, normalizedRetention, now)
            : triggerDate ? 'aktif' : 'belum_ditentukan';

        let effectiveDispositionCode: string | null = requiresHumanAppraisal
            ? null
            : dispositionCode;
        let effectiveDecisionSource: 'jra' | 'appraisal' | null = requiresHumanAppraisal
            ? null
            : 'jra';
        let effectiveAppraisalDecisionId: string | null = null;

        if (evidence.currentAppraisalDecisionId) {
            if (evidence.appraisalDecisionRecordId !== evidence.currentAppraisalDecisionId
                || evidence.appraisalDecisionArsipId !== evidence.arsipId
                || evidence.appraisalDecisionStatus !== 'approved'
                || evidence.appraisalCaseStatus !== 'approved') {
                return blocked('keputusan appraisal saat ini tidak sah atau bukan milik arsip ini');
            }
            if (!evidence.appraisalDecisionSnapshot || !evidence.appraisalDecisionSha256
                || sha256(evidence.appraisalDecisionSnapshot) !== evidence.appraisalDecisionSha256) {
                return blocked('hash keputusan appraisal saat ini tidak valid');
            }
            const decision = snapshotObject(evidence.appraisalDecisionSnapshot);
            const submission = snapshotObject(decision?.submissionSnapshot);
            const submittedRule = snapshotObject(submission?.ruleSnapshot);
            const submittedArchive = snapshotObject(submission?.archive);
            const submittedTrigger = snapshotObject(submission?.retentionTrigger);
            const submittedEvent = snapshotObject(submittedTrigger?.event);
            const submittedVerification = snapshotObject(submittedTrigger?.verification);
            if (!decision || decision.schemaVersion !== 1
                || String(decision.arsipId || '') !== String(evidence.arsipId || '')
                || submittedRule?.id !== evidence.currentRuleSnapshotId
                || submittedRule?.sha256 !== evidence.snapshotSha256
                || submittedArchive?.retentionDecisionHash !== evidence.retentionDecisionHash
                || submittedEvent?.id !== evidence.currentRetentionTriggerEventId
                || submittedVerification?.verdict !== 'verified'
                || submittedVerification?.verifierId !== evidence.triggerVerifierId) {
                return blocked('keputusan appraisal sudah kedaluwarsa terhadap aturan atau pemicu retensi saat ini');
            }
            const outcome = String(evidence.appraisalDecisionOutcome || '');
            if (!['musnah', 'permanen', 'dinilai_kembali'].includes(outcome)) {
                return blocked('hasil keputusan appraisal saat ini tidak dikenal');
            }
            effectiveDispositionCode = outcome;
            effectiveDecisionSource = 'appraisal';
            effectiveAppraisalDecisionId = evidence.currentAppraisalDecisionId;
        }

        const hasFinalOutcome = ['musnah', 'permanen'].includes(effectiveDispositionCode || '');
        const lifecycleReady = calculationEligible ? status === 'kadaluarsa' : true;
        const dispositionEligible = hasFinalOutcome
            && lifecycleReady
            && !evidence.hasActiveAppraisalCase;
        const dispositionBlockReason = dispositionEligible
            ? null
            : evidence.hasActiveAppraisalCase
                ? 'masih ada appraisal aktif yang dapat mengubah keputusan retensi'
                : !hasFinalOutcome
                    ? 'hasil akhir efektif masih memerlukan appraisal'
                    : calculationEligible
                        ? 'masa retensi arsip belum berakhir'
                        : 'keputusan appraisal efektif belum tersedia';

        return {
            verified: true,
            blockReason: null,
            calculationEligible,
            calculationBlockReason,
            normalizedRetention,
            dates,
            status,
            effectiveDispositionCode,
            effectiveDecisionSource,
            effectiveAppraisalDecisionId,
            dispositionEligible,
            dispositionBlockReason,
        };
    }

    async attachInitialSnapshot(
        executor: Executor,
        arsipId: string,
        assignment: Awaited<ReturnType<ArchiveRuleAssignmentService['resolveActive']>>,
        createdBy?: string,
    ) {
        const [record] = await executor.insert(arsipRuleSnapshots).values({
            arsipId,
            revision: 1,
            status: 'verified',
            klasifikasiItemId: assignment.cache.klasifikasiArsipId,
            klasifikasiRuleSetId: assignment.cache.klasifikasiRuleSetId,
            jraItemId: assignment.cache.jraItemId,
            jraRuleSetId: assignment.cache.jraRuleSetId,
            snapshot: assignment.snapshot,
            snapshotSha256: assignment.snapshotSha256,
            reason: 'Registrasi awal berdasarkan master peraturan aktif.',
            createdBy: createdBy || null,
        }).returning();

        const [updated] = await executor.update(arsip).set({
            currentRuleSnapshotId: record.id,
            ruleProvenanceStatus: 'verified',
            updatedAt: new Date(),
        }).where(eq(arsip.id, arsipId)).returning();

        return updated;
    }

    /**
     * Replace a classification/JRA decision without destroying its history.
     * The caller must lock and authorize the archive first. The append-only
     * snapshot table plus the archive row lock make the revision sequence
     * deterministic even when two correction requests arrive together.
     */
    async appendRevision(
        executor: Executor,
        arsipId: string,
        assignment: Awaited<ReturnType<ArchiveRuleAssignmentService['resolveActive']>>,
        reason: string,
        retentionTriggerDate?: string | null,
        createdBy?: string,
    ) {
        const [previous] = await executor
            .select({ id: arsipRuleSnapshots.id, revision: arsipRuleSnapshots.revision })
            .from(arsipRuleSnapshots)
            .where(eq(arsipRuleSnapshots.arsipId, arsipId))
            .orderBy(desc(arsipRuleSnapshots.revision))
            .limit(1);

        const [record] = await executor.insert(arsipRuleSnapshots).values({
            arsipId,
            revision: (previous?.revision || 0) + 1,
            status: 'verified',
            klasifikasiItemId: assignment.cache.klasifikasiArsipId,
            klasifikasiRuleSetId: assignment.cache.klasifikasiRuleSetId,
            jraItemId: assignment.cache.jraItemId,
            jraRuleSetId: assignment.cache.jraRuleSetId,
            snapshot: assignment.snapshot,
            snapshotSha256: assignment.snapshotSha256,
            supersedesSnapshotId: previous?.id || null,
            reason: reason.trim(),
            createdBy: createdBy || null,
        }).returning();

        const tanggalKadaluarsa = this.calculateExpiry(
            retentionTriggerDate,
            assignment.normalizedRetention,
        );
        const [updated] = await executor.update(arsip).set({
            ...assignment.cache,
            tanggalKadaluarsa,
            currentRuleSnapshotId: record.id,
            currentAppraisalDecisionId: null,
            ruleProvenanceStatus: 'verified',
            updatedAt: new Date(),
        }).where(eq(arsip.id, arsipId)).returning();

        return { archive: updated, snapshot: record };
    }
}

export const archiveRuleAssignmentService = new ArchiveRuleAssignmentService();
