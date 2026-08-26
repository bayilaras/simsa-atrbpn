import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import {
    arsip,
    arsipRuleSnapshots,
    jadwalRetensiArsip,
    klasifikasiArsip,
    regulatoryRuleSets,
} from '../db/schema';
import { ConflictError, ValidationError } from '../utils/errors';

export interface RuleSelectionInput {
    klasifikasiItemId?: number;
    kodeKlasifikasi?: string;
    jraItemId?: number;
    jraKode?: string;
}

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

        const snapshot = {
            schemaVersion: 1,
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
        normalized: {
            activeMonths: number | null;
            inactiveMonths: number | null;
            calculationMode: string;
            triggerGuidance?: string | null;
        },
    ): string | null {
        if (!triggerDate) return null;
        if (normalized.calculationMode === 'duration'
            && normalized.activeMonths !== null
            && normalized.inactiveMonths !== null) {
            return addMonths(triggerDate, normalized.activeMonths + normalized.inactiveMonths);
        }
        // For event-based active retention (for example "selama dipergunakan"),
        // the documented trigger is the date that active use ended. Only the
        // numeric inactive period is added. Rows without a usable inactive
        // period remain non-actionable and require appraisal.
        if (normalized.calculationMode === 'manual'
            && normalized.activeMonths === null
            && normalized.inactiveMonths !== null
            && String(normalized.triggerGuidance || '').trim()) {
            return addMonths(triggerDate, normalized.inactiveMonths);
        }
        return null;
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
            ruleProvenanceStatus: 'verified',
            updatedAt: new Date(),
        }).where(eq(arsip.id, arsipId)).returning();

        return { archive: updated, snapshot: record };
    }
}

export const archiveRuleAssignmentService = new ArchiveRuleAssignmentService();
