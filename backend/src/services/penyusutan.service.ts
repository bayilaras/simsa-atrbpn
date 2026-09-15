import { db } from '../config/database';
import {
    penyusutanArsip, NewPenyusutanArsip, PenyusutanArsip,
    penyusutanItems, NewPenyusutanItem,
    arsip, arsipRuleSnapshots, fileAttachments, users, recordAccessGrants,
    jraAppraisalCases, jraAppraisalDecisions,
    retentionTriggerEvents, retentionTriggerVerifications,
} from '../db/schema';
import { eq, and, desc, sql, inArray, isNotNull, getTableColumns, gt, or, asc } from 'drizzle-orm';
import { arsipService } from './arsip.service';
import {
    CURRENT_APPRAISAL_CASE_JOIN,
    CURRENT_APPRAISAL_DECISION_JOIN,
    CURRENT_RETENTION_TRIGGER_JOIN,
    CURRENT_RETENTION_VERIFICATION_JOIN,
    RETENTION_GOVERNANCE_EVIDENCE_SELECT,
} from './archive-rule-assignment.service';
import { AppError, ValidationError, ForbiddenError, ConflictError } from '../utils/errors';
import {
    NO_RECORD_UNIT_ACCESS,
    scopedRecordByIdWhere,
    type RecordUnitScope,
} from '../utils/record-unit-scope';
import { assertLegacyPermanentTransferMutationAllowed } from '../utils/permanent-transfer-policy';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';
import { resolveEffectiveUnitKerjaId } from '../utils/resolve-unit-kerja.js';
import type { Role } from '../config/permissions.js';
import { normalizeSecurityClassification, requiresExplicitAccessGrant, isAllowedForRecordUnit, isAllowedForClassification } from './record-access.service';
import { isFileReleased } from './file-release-policy';
import { buildDestructionEvidenceSnapshot, destructionDocumentIds, parseDestructionEvidence } from './penyusutan-execution-evidence';
import { recoverInactiveTransferSchema } from '../validators/penyusutan-evidence.schemas';
import { fileAttachmentService } from './file-attachment.service';
import { lockDispositionActor, type DispositionActor } from './penyusutan-authority';

const jakartaCalendar = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
});

// Types
interface PenyusutanFilters {
    unitKerjaId: string;
    jenisPenyusutan?: 'pemindahan' | 'pemusnahan' | 'penyerahan';
    status?: string;
    page?: number;
    limit?: number;
    securityClassifications?: string[] | null;
}

interface CreatePenyusutanData {
    unitKerjaId: string;
    jenisPenyusutan: 'pemindahan' | 'pemusnahan' | 'penyerahan' | 'alih_media';
    nomorBA?: string;
    keterangan?: string;
    arsipIds: string[];
    createdBy?: string;
    securityClassifications?: string[] | null;
    auditContext?: CriticalAuditContext;
}

const RULE_SNAPSHOT_EVIDENCE_SELECT = {
    ruleSnapshotId: arsipRuleSnapshots.id,
    ruleSnapshotArsipId: arsipRuleSnapshots.arsipId,
    ruleSnapshotStatus: arsipRuleSnapshots.status,
    ruleSnapshotJraItemId: arsipRuleSnapshots.jraItemId,
    ruleSnapshotJraRuleSetId: arsipRuleSnapshots.jraRuleSetId,
    ruleSnapshot: arsipRuleSnapshots.snapshot,
    ruleSnapshotSha256: arsipRuleSnapshots.snapshotSha256,
};

const ARCHIVE_WITH_RULE_SNAPSHOT_SELECT = {
    ...getTableColumns(arsip),
    ...RULE_SNAPSHOT_EVIDENCE_SELECT,
    ...RETENTION_GOVERNANCE_EVIDENCE_SELECT,
};

const CURRENT_RULE_SNAPSHOT_JOIN = and(
    eq(arsipRuleSnapshots.id, arsip.currentRuleSnapshotId),
    eq(arsipRuleSnapshots.arsipId, arsip.id),
);

const protectedDesignation = sql<boolean>`EXISTS (
    SELECT 1 FROM arsip_terjaga protected_archive WHERE protected_archive.arsip_id = ${arsip.id}
)`;

async function assertManageGrants(tx: any, rows: any[], actor: DispositionActor) {
    for (const row of rows) {
        if (!isAllowedForClassification(actor, row.klasifikasiKeamanan)) throw new ForbiddenError('Kewenangan klasifikasi arsip terkini diperlukan.');
        if (!requiresExplicitAccessGrant(row.klasifikasiKeamanan)) continue;
        const [grant] = await tx.select({ id: recordAccessGrants.id })
            .from(recordAccessGrants).where(and(
                eq(recordAccessGrants.entityType, 'arsip'), eq(recordAccessGrants.entityId, row.id),
                eq(recordAccessGrants.targetUserId, actor.id), eq(recordAccessGrants.unitKerjaId, row.unitKerjaId),
                eq(recordAccessGrants.requiredClassification, normalizeSecurityClassification(row.klasifikasiKeamanan)),
                eq(recordAccessGrants.status, 'approved'), eq(recordAccessGrants.accessMode, 'manage'),
                gt(recordAccessGrants.expiresAt, new Date()),
            )).limit(1).for('share');
        if (!grant) throw new ForbiddenError('Akses kelola per arsip yang masih berlaku diperlukan.');
    }
}

type PenyusutanStatus = 'draft' | 'proposed' | 'reviewed' | 'approved' | 'executed';

const STATUS_FLOW: Record<PenyusutanStatus, PenyusutanStatus | null> = {
    draft: 'proposed',
    proposed: 'reviewed',
    reviewed: 'approved',
    approved: 'executed',
    executed: null, // Terminal state
};

const JENIS_TO_DISPOSAL_STATUS: Record<string, string> = {
    pemindahan: 'proposed_pindah',
    pemusnahan: 'proposed_musnah',
    penyerahan: 'proposed_serah',
    alih_media: 'proposed_alih_media',
};

function archiveSecurityCondition(classes: string[] | null | undefined) {
    if (classes === undefined || classes === null) return undefined;
    if (classes.length === 0) return sql`false`;
    return inArray(
        sql<string>`lower(coalesce(${arsip.klasifikasiKeamanan}, 'biasa'))`,
        classes,
    );
}

function batchSecurityCondition(classes: string[] | null | undefined) {
    if (classes === undefined || classes === null) return undefined;
    if (classes.length === 0) return sql`false`;
    const allowed = sql.join(classes.map(value => sql`${value}`), sql`, `);
    return sql`NOT EXISTS (
        SELECT 1
        FROM penyusutan_items security_item
        INNER JOIN arsip security_arsip ON security_arsip.id = security_item.arsip_id
        WHERE security_item.penyusutan_id = ${penyusutanArsip.id}
          AND lower(coalesce(security_arsip.klasifikasi_keamanan, 'biasa')) NOT IN (${allowed})
    )`;
}

function isAllowedArchiveClass(
    classification: string | null | undefined,
    classes: string[] | null | undefined,
) {
    if (classes === undefined || classes === null) return true;
    return classes.includes((classification || 'biasa').trim().toLowerCase());
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function assertArchiveIdList(arsipIds: string[]) {
    if (arsipIds.length === 0) {
        throw new ValidationError('Minimal satu arsip harus dipilih.');
    }
    if (new Set(arsipIds).size !== arsipIds.length) {
        throw new ValidationError('Daftar arsip mengandung ID duplikat.');
    }
}

/**
 * A disposal decision may only use the immutable rule assignment captured when
 * the archive was registered (or subsequently re-verified). Denormalized labels
 * alone are deliberately insufficient: IDs and hashes make the exact rule
 * versions behind the decision traceable.
 */
function getRuleProvenanceBlockReason(row: any): string | null {
    const status = String(row.ruleProvenanceStatus || '').trim().toLowerCase();

    if (status === 'legacy_unverified') {
        return 'status legacy_unverified: arsip lama belum diverifikasi terhadap master klasifikasi dan JRA aktif; lakukan verifikasi aturan terlebih dahulu';
    }
    if (status === 'pending_jra') {
        return 'status pending_jra: penetapan JRA belum selesai; pilih butir JRA aktif dan simpan snapshot aturan terverifikasi';
    }
    if (status !== 'verified') {
        return 'status provenance aturan harus verified';
    }

    const missing: string[] = [];
    if (!Number.isInteger(row.klasifikasiArsipId) || row.klasifikasiArsipId <= 0) {
        missing.push('klasifikasiArsipId');
    }
    if (!String(row.klasifikasiRuleSetId || '').trim()) missing.push('klasifikasiRuleSetId');
    if (!Number.isInteger(row.jraItemId) || row.jraItemId <= 0) missing.push('jraItemId');
    if (!String(row.jraRuleSetId || '').trim()) missing.push('jraRuleSetId');
    if (!String(row.currentRuleSnapshotId || '').trim()) missing.push('currentRuleSnapshotId');
    if (!SHA256_PATTERN.test(String(row.klasifikasiSnapshotHash || ''))) {
        missing.push('klasifikasiSnapshotHash');
    }
    if (!SHA256_PATTERN.test(String(row.retentionDecisionHash || ''))) {
        missing.push('retentionDecisionHash');
    }

    if (missing.length > 0) {
        return `snapshot aturan terverifikasi tidak lengkap atau tidak valid (${missing.join(', ')})`;
    }
    return null;
}

function assertVerifiedRuleProvenance(rows: any[], context: string) {
    const blocked = rows
        .map((row: any) => ({ row, reason: getRuleProvenanceBlockReason(row) }))
        .filter((item: any) => item.reason);
    if (blocked.length > 0) {
        throw new ValidationError(
            `${context}: ${blocked.map((item: any) => `${item.row.id} (${item.reason})`).join(', ')}`
        );
    }
}

class PenyusutanService {
    /**
     * List all penyusutan batches with pagination
     */
    async findAll(filters: PenyusutanFilters) {
        const {
            unitKerjaId,
            jenisPenyusutan,
            status,
            page = 1,
            limit = 20,
            securityClassifications,
        } = filters;
        const offset = (page - 1) * limit;

        const conditions = [eq(penyusutanArsip.unitKerjaId, unitKerjaId)];
        if (jenisPenyusutan) conditions.push(eq(penyusutanArsip.jenisPenyusutan, jenisPenyusutan));
        if (status) conditions.push(eq(penyusutanArsip.status, status));
        const securityCondition = batchSecurityCondition(securityClassifications);
        if (securityCondition) conditions.push(securityCondition);

        const [data, countResult] = await Promise.all([
            db.select()
                .from(penyusutanArsip)
                .where(and(...conditions))
                .orderBy(desc(penyusutanArsip.createdAt))
                .limit(limit)
                .offset(offset),
            db.select({ count: sql<number>`count(*)` })
                .from(penyusutanArsip)
                .where(and(...conditions)),
        ]);

        const total = Number(countResult[0]?.count || 0);

        return {
            data,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    /**
     * Get single batch with its items and arsip details
     */
    async findById(
        id: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ) {
        const batch = await db.select().from(penyusutanArsip).where(and(
            scopedRecordByIdWhere(
                penyusutanArsip.id,
                id,
                penyusutanArsip.unitKerjaId,
                unitScope,
            ),
            batchSecurityCondition(securityClassifications),
        ));
        if (!batch[0]) return null;

        const items = await db.select({
            item: penyusutanItems,
            arsip: arsip,
        })
            .from(penyusutanItems)
            .innerJoin(arsip, eq(penyusutanItems.arsipId, arsip.id))
            .where(and(
                eq(penyusutanItems.penyusutanId, id),
                archiveSecurityCondition(securityClassifications),
            ))
            .orderBy(penyusutanItems.nomorUrut);

        return {
            ...batch[0],
            items: items.map(i => ({
                ...i.item,
                arsip: i.arsip,
            })),
        };
    }

    /**
     * Ensure every arsip may be placed in a batch of the given unit: it has to exist,
     * belong to that unit, and not already be claimed by another batch — otherwise its
     * disposalBatchId would be silently overwritten while the old batch still lists it.
     */
    private getDispositionBlockReason(row: any, jenisPenyusutan: string): string | null {
        if (jenisPenyusutan === 'pemusnahan' && row.isTerjaga) {
            return 'arsip terjaga memerlukan peninjauan penetapan oleh Unit Kearsipan sebelum pemusnahan';
        }
        if (jenisPenyusutan === 'pemindahan' && (row.inactiveTransferredAt || row.inactiveTransferBatchId)) {
            return 'arsip sudah dipindahkan ke penyimpanan inaktif';
        }
        // Alih media is a preservation action, not a retention outcome. Its
        // separate controls must not be made dependent on a calculable JRA.
        if (jenisPenyusutan === 'alih_media') return null;

        const evaluation = arsipService.evaluateCanonicalRetention(row);
        if (!evaluation.verified) {
            return evaluation.blockReason || 'snapshot JRA tidak terverifikasi';
        }
        const status = evaluation.status;
        const dispositionCode = evaluation.effectiveDispositionCode;

        if (jenisPenyusutan === 'pemindahan') {
            if (!evaluation.calculationEligible
                || evaluation.normalizedRetention?.calculationMode !== 'duration') {
                return evaluation.calculationBlockReason
                    || 'aturan JRA tidak memiliki durasi terstruktur';
            }
            if (!['inaktif', 'akan_kadaluarsa', 'kadaluarsa'].includes(status)) {
                return 'masa aktif belum berakhir';
            }
            return null;
        }

        if (jenisPenyusutan === 'pemusnahan') {
            if (dispositionCode !== 'musnah') {
                return dispositionCode
                    ? 'keputusan efektif bukan Musnah'
                    : evaluation.dispositionBlockReason
                        || 'hasil akhir JRA memerlukan appraisal efektif';
            }
            if (!evaluation.dispositionEligible) {
                return evaluation.dispositionBlockReason || 'arsip belum layak dimusnahkan';
            }
        }
        if (jenisPenyusutan === 'penyerahan') {
            if (dispositionCode !== 'permanen') {
                return dispositionCode
                    ? 'keputusan efektif bukan Permanen'
                    : evaluation.dispositionBlockReason
                        || 'hasil akhir JRA memerlukan appraisal efektif';
            }
            if (!evaluation.dispositionEligible) {
                return evaluation.dispositionBlockReason || 'arsip belum layak diserahkan';
            }
        }
        return null;
    }

    private async assertArsipEligible(
        tx: any,
        arsipIds: string[],
        unitKerjaId: string,
        jenisPenyusutan: string,
        securityClassifications?: string[] | null,
    ) {
        const rows = await tx.select({
            id: arsip.id,
            unitKerjaId: arsip.unitKerjaId,
            disposalStatus: arsip.disposalStatus,
            disposalBatchId: arsip.disposalBatchId,
            inactiveTransferredAt: arsip.inactiveTransferredAt,
            inactiveTransferBatchId: arsip.inactiveTransferBatchId,
            isTerjaga: protectedDesignation,
            retentionTriggerDate: arsip.retentionTriggerDate,
            retensiAktif: arsip.retensiAktif,
            retensiInaktif: arsip.retensiInaktif,
            hasilAkhir: arsip.hasilAkhir,
            jraKode: arsip.jraKode,
            jraVersion: arsip.jraVersion,
            jraReference: arsip.jraReference,
            klasifikasiArsipId: arsip.klasifikasiArsipId,
            klasifikasiRuleSetId: arsip.klasifikasiRuleSetId,
            klasifikasiSnapshotHash: arsip.klasifikasiSnapshotHash,
            jraItemId: arsip.jraItemId,
            jraRuleSetId: arsip.jraRuleSetId,
            retentionDecisionHash: arsip.retentionDecisionHash,
            currentRuleSnapshotId: arsip.currentRuleSnapshotId,
            currentRetentionTriggerEventId: arsip.currentRetentionTriggerEventId,
            currentAppraisalDecisionId: arsip.currentAppraisalDecisionId,
            ruleProvenanceStatus: arsip.ruleProvenanceStatus,
            legalHold: arsip.legalHold,
            klasifikasiKeamanan: arsip.klasifikasiKeamanan,
            ...RULE_SNAPSHOT_EVIDENCE_SELECT,
            ...RETENTION_GOVERNANCE_EVIDENCE_SELECT,
        })
            .from(arsip)
            .leftJoin(arsipRuleSnapshots, CURRENT_RULE_SNAPSHOT_JOIN)
            .leftJoin(retentionTriggerEvents, CURRENT_RETENTION_TRIGGER_JOIN)
            .leftJoin(retentionTriggerVerifications, CURRENT_RETENTION_VERIFICATION_JOIN)
            .leftJoin(jraAppraisalDecisions, CURRENT_APPRAISAL_DECISION_JOIN)
            .leftJoin(jraAppraisalCases, CURRENT_APPRAISAL_CASE_JOIN)
            .where(inArray(arsip.id, arsipIds))
            .for('update', { of: arsip });

        const foundIds = new Set(rows.map((r: any) => r.id));
        const missing = arsipIds.filter(id => !foundIds.has(id));
        if (missing.length > 0) {
            throw new ValidationError(`Arsip tidak ditemukan: ${missing.join(', ')}`);
        }

        const luarUnit = rows.filter((r: any) => r.unitKerjaId !== unitKerjaId);
        if (luarUnit.length > 0) {
            throw new ValidationError(
                `Arsip di luar unit kerja batch tidak dapat disusutkan: ${luarUnit.map((r: any) => r.id).join(', ')}`
            );
        }

        const sudahDiproses = rows.filter((r: any) => r.disposalStatus !== 'active' || r.disposalBatchId);
        if (sudahDiproses.length > 0) {
            throw new ValidationError(
                `Arsip sudah termasuk dalam proses penyusutan lain: ${sudahDiproses.map((r: any) => r.id).join(', ')}`
            );
        }

        const diLuarKewenangan = rows.filter((r: any) =>
            !isAllowedArchiveClass(r.klasifikasiKeamanan, securityClassifications)
        );
        if (diLuarKewenangan.length > 0) {
            throw new ValidationError('Sebagian arsip tidak ditemukan atau tidak dapat diakses.');
        }

        const ditahan = rows.filter((r: any) => r.legalHold);
        if (ditahan.length > 0) {
            throw new ValidationError(
                `Arsip sedang dalam legal hold dan tidak dapat disusutkan: ${ditahan.map((r: any) => r.id).join(', ')}`
            );
        }

        const tanpaPemicu = rows.filter((r: any) => !r.currentRetentionTriggerEventId);
        if (tanpaPemicu.length > 0) {
            throw new ValidationError(
                `Arsip belum memiliki pemicu retensi yang sah: ${tanpaPemicu.map((r: any) => r.id).join(', ')}`
            );
        }

        assertVerifiedRuleProvenance(
            rows,
            'Arsip tidak dapat dimasukkan ke batch penyusutan karena provenance aturan belum terverifikasi',
        );

        if (jenisPenyusutan === 'pemusnahan' || jenisPenyusutan === 'penyerahan') {
            const tanpaProvenanceJra = rows.filter((r: any) =>
                !String(r.jraKode || '').trim()
                || !String(r.jraVersion || '').trim()
                || !String(r.jraReference || '').trim()
            );
            if (tanpaProvenanceJra.length > 0) {
                throw new ValidationError(
                    `Arsip belum memiliki provenance JRA lengkap (kode, versi, dan referensi): ${tanpaProvenanceJra.map((r: any) => r.id).join(', ')}`
                );
            }
        }

        const tidakLayak = rows
            .map((row: any) => ({ row, reason: this.getDispositionBlockReason(row, jenisPenyusutan) }))
            .filter((item: any) => item.reason);
        if (tidakLayak.length > 0) {
            throw new ValidationError(
                `Arsip belum layak untuk ${jenisPenyusutan}: ${tidakLayak.map((item: any) => `${item.row.id} (${item.reason})`).join(', ')}`
            );
        }
    }

    private async assertBatchRetentionEligible(
        tx: any,
        batchId: string,
        jenisPenyusutan: string,
        securityClassifications?: string[] | null,
    ) {
        const rows = await tx.select({
            id: arsip.id,
            unitKerjaId: arsip.unitKerjaId,
            inactiveTransferredAt: arsip.inactiveTransferredAt,
            inactiveTransferBatchId: arsip.inactiveTransferBatchId,
            isTerjaga: protectedDesignation,
            retentionTriggerDate: arsip.retentionTriggerDate,
            retensiAktif: arsip.retensiAktif,
            retensiInaktif: arsip.retensiInaktif,
            hasilAkhir: arsip.hasilAkhir,
            jraKode: arsip.jraKode,
            jraVersion: arsip.jraVersion,
            jraReference: arsip.jraReference,
            klasifikasiArsipId: arsip.klasifikasiArsipId,
            klasifikasiRuleSetId: arsip.klasifikasiRuleSetId,
            klasifikasiSnapshotHash: arsip.klasifikasiSnapshotHash,
            jraItemId: arsip.jraItemId,
            jraRuleSetId: arsip.jraRuleSetId,
            retentionDecisionHash: arsip.retentionDecisionHash,
            currentRuleSnapshotId: arsip.currentRuleSnapshotId,
            currentRetentionTriggerEventId: arsip.currentRetentionTriggerEventId,
            currentAppraisalDecisionId: arsip.currentAppraisalDecisionId,
            ruleProvenanceStatus: arsip.ruleProvenanceStatus,
            legalHold: arsip.legalHold,
            klasifikasiKeamanan: arsip.klasifikasiKeamanan,
            ...RULE_SNAPSHOT_EVIDENCE_SELECT,
            ...RETENTION_GOVERNANCE_EVIDENCE_SELECT,
        })
            .from(penyusutanItems)
            .innerJoin(arsip, eq(penyusutanItems.arsipId, arsip.id))
            .leftJoin(arsipRuleSnapshots, CURRENT_RULE_SNAPSHOT_JOIN)
            .leftJoin(retentionTriggerEvents, CURRENT_RETENTION_TRIGGER_JOIN)
            .leftJoin(retentionTriggerVerifications, CURRENT_RETENTION_VERIFICATION_JOIN)
            .leftJoin(jraAppraisalDecisions, CURRENT_APPRAISAL_DECISION_JOIN)
            .leftJoin(jraAppraisalCases, CURRENT_APPRAISAL_CASE_JOIN)
            .where(eq(penyusutanItems.penyusutanId, batchId))
            .for('update', { of: arsip });

        if (rows.length === 0) {
            throw new ValidationError('Workflow penyusutan tidak dapat diproses tanpa arsip.');
        }

        if (rows.some((row: any) =>
            !isAllowedArchiveClass(row.klasifikasiKeamanan, securityClassifications)
        )) {
            throw new ValidationError('Batch tidak ditemukan atau tidak dapat diakses.');
        }

        const blocked = rows.filter((row: any) =>
            row.legalHold || !row.currentRetentionTriggerEventId,
        );
        if (blocked.length > 0) {
            throw new ValidationError(
                `Workflow penyusutan dihentikan: arsip tanpa pemicu retensi atau dalam legal hold: ${blocked.map((r: any) => r.id).join(', ')}`
            );
        }

        assertVerifiedRuleProvenance(
            rows,
            'Workflow penyusutan dihentikan karena provenance aturan belum terverifikasi',
        );

        if (jenisPenyusutan === 'pemusnahan' || jenisPenyusutan === 'penyerahan') {
            const tanpaProvenanceJra = rows.filter((r: any) =>
                !String(r.jraKode || '').trim()
                || !String(r.jraVersion || '').trim()
                || !String(r.jraReference || '').trim()
            );
            if (tanpaProvenanceJra.length > 0) {
                throw new ValidationError(
                    `Workflow penyusutan dihentikan karena provenance JRA tidak lengkap: ${tanpaProvenanceJra.map((r: any) => r.id).join(', ')}`
                );
            }
        }

        const tidakLayak = rows
            .map((row: any) => ({ row, reason: this.getDispositionBlockReason(row, jenisPenyusutan) }))
            .filter((item: any) => item.reason);
        if (tidakLayak.length > 0) {
            throw new ValidationError(
                `Workflow penyusutan dihentikan karena kelayakan JRA berubah: ${tidakLayak.map((item: any) => `${item.row.id} (${item.reason})`).join(', ')}`
            );
        }
        return rows;
    }

    /**
     * Create a new penyusutan batch with arsip items
     */
    async create(data: CreatePenyusutanData) {
        assertLegacyPermanentTransferMutationAllowed(data.jenisPenyusutan);
        const { arsipIds, securityClassifications, auditContext, ...batchData } = data;
        assertArchiveIdList(arsipIds);

        // Generate nomor BA
        const now = new Date();
        const nomorBA = data.nomorBA ||
            `BA-${data.jenisPenyusutan.toUpperCase().substring(0, 3)}-${data.unitKerjaId}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;

        return await db.transaction(async (tx: any) => {
            if (arsipIds.length > 0) {
                await this.assertArsipEligible(
                    tx,
                    arsipIds,
                    batchData.unitKerjaId,
                    batchData.jenisPenyusutan,
                    securityClassifications,
                );
            }

            // Create batch
            const [batch] = await tx.insert(penyusutanArsip).values({
                unitKerjaId: batchData.unitKerjaId,
                jenisPenyusutan: batchData.jenisPenyusutan,
                nomorBA,
                keterangan: batchData.keterangan,
                totalBerkas: arsipIds.length,
                createdBy: batchData.createdBy,
                status: 'draft',
            }).returning();

            // Add items
            if (arsipIds.length > 0) {
                const itemsToInsert = arsipIds.map((arsipId, index) => ({
                    penyusutanId: batch.id,
                    arsipId,
                    nomorUrut: index + 1,
                }));
                await tx.insert(penyusutanItems).values(itemsToInsert);

                // Update arsip disposalStatus
                const disposalStatus = JENIS_TO_DISPOSAL_STATUS[data.jenisPenyusutan] || 'active';
                await tx.update(arsip)
                    .set({
                        disposalStatus,
                        disposalBatchId: batch.id,
                        updatedAt: new Date(),
                    })
                    .where(inArray(arsip.id, arsipIds));
            }

            if (auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'create',
                    entityType: 'penyusutan',
                    entityId: batch.id,
                    changes: {
                        after: {
                            unitKerjaId: batch.unitKerjaId,
                            jenisPenyusutan: batch.jenisPenyusutan,
                            status: batch.status,
                            nomorBA: batch.nomorBA,
                            totalBerkas: arsipIds.length,
                        },
                    },
                }, tx);
            }

            return batch;
        });
    }

    /**
     * Advance the workflow status of a batch
     */
    async updateStatus(
        id: string,
        metadata?: {
            catatan?: string;
            executionEvidence?: unknown;
            user?: {
                id: string;
                email?: string;
                role: string;
                unitKerjaId: string;
                ipAddress?: string;
            };
        },
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ) {
        if (!metadata?.user) throw new ForbiddenError('Authenticated actor is required for a disposition transition');

        const result = await db.transaction(async (tx: any) => {
            const batch = await tx.select().from(penyusutanArsip).where(and(
                scopedRecordByIdWhere(
                    penyusutanArsip.id,
                    id,
                    penyusutanArsip.unitKerjaId,
                    unitScope,
                ),
                batchSecurityCondition(securityClassifications),
            )).for('update');
            if (!batch[0]) throw new AppError('Penyusutan batch not found', 404);
            assertLegacyPermanentTransferMutationAllowed(batch[0].jenisPenyusutan);

            const currentStatus = batch[0].status as PenyusutanStatus;
            const nextStatus = STATUS_FLOW[currentStatus];
            if (!nextStatus) throw new ValidationError(`Cannot advance from status: ${currentStatus}`);

            const actor = await lockDispositionActor(tx, metadata.user!, id, batch[0].unitKerjaId);
            const { id: actorId, role, unitKerjaId } = actor;
            const effectiveActorUnitKerjaId = resolveEffectiveUnitKerjaId(
                role as Role,
                unitKerjaId,
            );

            // Every non-super-admin transition is bound to both the resolved route
            // scope and the actor's assigned unit. Never trust the batch ID alone.
            if (role !== 'super_admin' && (
                unitScope === null
                || !unitScope
                || batch[0].unitKerjaId !== unitScope
                || batch[0].unitKerjaId !== effectiveActorUnitKerjaId
            )) {
                throw new ForbiddenError('Unauthorized: You can only transition batches for your own unit');
            }

            if (currentStatus === 'proposed' && nextStatus === 'reviewed') {
                if (!['super_admin', 'admin_unit', 'admin_dirjen', 'admin_sesditjen'].includes(role)) {
                    throw new ForbiddenError('Unauthorized: Insufficient role to review');
                }
                if ([batch[0].createdBy, batch[0].proposedBy].filter(Boolean).includes(actorId)) {
                    throw new ForbiddenError('Separation of duties: reviewer must differ from creator/proposer');
                }
            }

            if (currentStatus === 'reviewed' && nextStatus === 'approved') {
                if (role !== 'super_admin') {
                    throw new ForbiddenError('Unauthorized: Insufficient role to approve');
                }
                if ([batch[0].createdBy, batch[0].proposedBy, batch[0].reviewedBy].filter(Boolean).includes(actorId)) {
                    throw new ForbiddenError('Separation of duties: approver must differ from creator/proposer/reviewer');
                }
            }

            if (currentStatus === 'approved' && nextStatus === 'executed') {
                if (role !== 'super_admin') {
                    throw new ForbiddenError('Unauthorized: Insufficient role to execute');
                }
                if ([
                    batch[0].createdBy,
                    batch[0].proposedBy,
                    batch[0].reviewedBy,
                    batch[0].approvedBy,
                ].filter(Boolean).includes(actorId)) {
                    throw new ForbiddenError('Separation of duties: executor must differ from creator/proposer/reviewer/approver');
                }
            }

            const destructionInput = nextStatus === 'executed' && batch[0].jenisPenyusutan === 'pemusnahan'
                ? parseDestructionEvidence(metadata.executionEvidence) : null;
            if (metadata.executionEvidence && !destructionInput) {
                throw new ValidationError('Bukti pelaksanaan hanya diterima saat pencatatan pemusnahan final.');
            }

            // Lock all archive rows while re-checking their retention and legal-hold
            // state. Concurrent hold placement must serialize with this transition.
            const lockedArchives = await this.assertBatchRetentionEligible(
                tx,
                id,
                batch[0].jenisPenyusutan,
                securityClassifications,
            );
            await assertManageGrants(tx, lockedArchives, actor);

            let execution: ReturnType<typeof buildDestructionEvidenceSnapshot> | null = null;
            if (destructionInput) {
                const attachments = await tx.select().from(fileAttachments)
                    .where(inArray(fileAttachments.id, destructionDocumentIds(destructionInput)))
                    .orderBy(asc(fileAttachments.id)).for('update');
                const witnesses = await tx.select().from(users)
                    .where(inArray(users.id, destructionInput.witnesses.map(w => w.userId)))
                    .orderBy(asc(users.id)).for('share');
                execution = buildDestructionEvidenceSnapshot({ input: destructionInput,
                    batch: batch[0], archiveIds: lockedArchives.map((row: any) => row.id),
                    executorId: actorId, attachments, witnesses });
                const checkedAttachments = [];
                for (const attachment of attachments) {
                    const checked = await fileAttachmentService.verifyIntegrity(attachment.id, tx);
                    if (!checked?.matches || !isFileReleased(checked.attachment)) {
                        // Commit the failed integrity state and its audit, never the disposition.
                        await auditLogService.logActionOrThrow({ userId: actor.id, userEmail: actor.email, ipAddress: actor.ipAddress,
                            action: 'update', entityType: 'penyusutan', entityId: id,
                            changes: { operation: 'execution_evidence_rejected', attachmentId: attachment.id,
                                expectedHash: checked?.expectedHash || attachment.sha256, actualHash: checked?.actualHash || null } }, tx);
                        return { evidenceFailure: true as const };
                    }
                    checkedAttachments.push(checked.attachment);
                }
                // A grant can expire while the storage bytes are being read.
                await assertManageGrants(tx, lockedArchives, actor);
                execution = buildDestructionEvidenceSnapshot({ input: destructionInput,
                    batch: batch[0], archiveIds: lockedArchives.map((row: any) => row.id),
                    executorId: actorId, attachments: checkedAttachments, witnesses });
            }

            const updateData: Record<string, any> = {
                status: nextStatus,
                updatedAt: new Date(),
            };
            const today = jakartaCalendar.format(new Date());
            if (nextStatus === 'proposed') {
                updateData.tanggalUsul = today;
                updateData.proposedBy = actorId;
            }
            if (nextStatus === 'reviewed') {
                updateData.tanggalReview = today;
                updateData.reviewedBy = actorId;
            }
            if (nextStatus === 'approved') {
                updateData.tanggalPersetujuan = today;
                updateData.approvedBy = actorId;
            }
            if (nextStatus === 'executed') {
                updateData.tanggalPelaksanaan = execution
                    ? jakartaCalendar.format(new Date(execution.snapshot.performedAt))
                    : today;
                updateData.executedBy = actorId;
                if (execution) {
                    updateData.executionEvidence = execution.snapshot;
                    updateData.executionEvidenceSha256 = execution.sha256;
                }
            }
            if (metadata.catatan) updateData.catatanPanitia = metadata.catatan;

            const [updated] = await tx.update(penyusutanArsip)
                .set(updateData)
                .where(and(
                    scopedRecordByIdWhere(
                        penyusutanArsip.id,
                        id,
                        penyusutanArsip.unitKerjaId,
                        unitScope,
                    ),
                    eq(penyusutanArsip.status, currentStatus),
                ))
                .returning();

            if (!updated) throw new ConflictError('Cannot advance: batch status changed concurrently');

            // A completed transfer/media operation releases the processing lock.
            // Its immutable batch membership remains the historical evidence.
            if (nextStatus === 'executed') {
                const items = await tx.select({ arsipId: penyusutanItems.arsipId })
                    .from(penyusutanItems)
                    .where(eq(penyusutanItems.penyusutanId, id));

                const arsipIds = items.map((i: any) => i.arsipId);
                if (arsipIds.length > 0) {
                    const isTransfer = batch[0].jenisPenyusutan === 'pemindahan';
                    const nonTerminal = isTransfer || batch[0].jenisPenyusutan === 'alih_media';
                    await tx.update(arsip)
                        .set({ disposalStatus: nonTerminal ? 'active' : 'executed',
                            ...(nonTerminal ? { disposalBatchId: null } : {}),
                            ...(isTransfer ? { inactiveTransferredAt: new Date(), inactiveTransferBatchId: id } : {}),
                            updatedAt: new Date() })
                        .where(inArray(arsip.id, arsipIds));
                }
            }

            // When approved, update arsip status to 'approved'
            if (nextStatus === 'approved') {
                const items = await tx.select({ arsipId: penyusutanItems.arsipId })
                    .from(penyusutanItems)
                    .where(eq(penyusutanItems.penyusutanId, id));

                const arsipIds = items.map((i: any) => i.arsipId);
                if (arsipIds.length > 0) {
                    await tx.update(arsip)
                        .set({ disposalStatus: 'approved', updatedAt: new Date() })
                    .where(inArray(arsip.id, arsipIds));
                }
            }

            await auditLogService.logActionOrThrow({
                userId: actorId,
                userEmail: actor.email,
                ipAddress: actor.ipAddress,
                action: 'status_change',
                entityType: 'penyusutan',
                entityId: id,
                changes: {
                    before: { status: currentStatus },
                    after: { status: nextStatus },
                    catatan: metadata.catatan || null,
                    executionEvidenceSha256: execution?.sha256 || null,
                    archiveLifecycleEffect: nextStatus === 'executed'
                        ? (batch[0].jenisPenyusutan === 'pemindahan' ? 'inactive_transfer_completed'
                            : batch[0].jenisPenyusutan === 'alih_media' ? 'media_operation_completed' : 'final_disposition_recorded')
                        : null,
                },
            }, tx);

            return updated;
        });
        if ('evidenceFailure' in result) throw new ConflictError('Integritas bukti gagal; pelaksanaan belum dicatat. Periksa lampiran bukti.');
        return result;
    }

    /**
     * Add arsip items to an existing draft batch
     */
    async uploadExecutionEvidence(id: string, arsipId: string,
        file: { originalname: string; mimetype: string; buffer: Buffer }, actor: DispositionActor,
        unitScope: RecordUnitScope, securityClassifications?: string[] | null) {
        if (actor.role !== 'super_admin') throw new ForbiddenError('Unggah bukti pelaksanaan memerlukan administrator berwenang.');
        return db.transaction(async tx => {
            const [batch] = await tx.select().from(penyusutanArsip).where(and(
                scopedRecordByIdWhere(penyusutanArsip.id, id, penyusutanArsip.unitKerjaId, unitScope),
                batchSecurityCondition(securityClassifications),
            )).limit(1).for('update');
            if (!batch) throw new AppError('Penyusutan batch not found', 404);
            if (batch.jenisPenyusutan !== 'pemusnahan' || batch.status !== 'approved') {
                throw new ConflictError('Unggah bukti hanya tersedia untuk pemusnahan yang telah disetujui.');
            }
            actor = await lockDispositionActor(tx, actor, id, batch.unitKerjaId);
            if (actor.role !== 'super_admin') throw new ForbiddenError('Kewenangan administrator terkini diperlukan untuk unggah bukti.');
            const [archive] = await tx.select({ ...getTableColumns(arsip), isTerjaga: protectedDesignation }).from(arsip)
                .innerJoin(penyusutanItems, eq(penyusutanItems.arsipId, arsip.id))
                .where(and(eq(penyusutanItems.penyusutanId, id), eq(arsip.id, arsipId)))
                .limit(1).for('update', { of: arsip });
            if (!archive || archive.unitKerjaId !== batch.unitKerjaId || archive.legalHold || archive.isTerjaga
                || archive.disposalStatus !== 'approved' || archive.disposalBatchId !== id
                || !isAllowedArchiveClass(archive.klasifikasiKeamanan, securityClassifications)) {
                throw new ConflictError('Arsip tidak tersedia untuk lampiran bukti pada batch ini.');
            }
            await assertManageGrants(tx, [archive], actor);
            await auditLogService.logActionOrThrow({ userId: actor.id, userEmail: actor.email, ipAddress: actor.ipAddress,
                action: 'update', entityType: 'penyusutan', entityId: id,
                changes: { operation: 'upload_execution_evidence', arsipId, fileName: file.originalname },
            }, tx);
            return fileAttachmentService.create({ suratId: arsipId, suratType: 'arsip',
                fileName: file.originalname, mimeType: file.mimetype, buffer: file.buffer, uploadedById: actor.id },
                { userId: actor.id, userEmail: actor.email, ipAddress: actor.ipAddress }, tx);
        });
    }

    async getExecutionOptions(id: string, actor: DispositionActor, unitScope: RecordUnitScope,
        securityClassifications?: string[] | null) {
        if (actor.role !== 'super_admin') throw new ForbiddenError('Hanya pencatat pelaksanaan yang dapat memilih bukti.');
        return db.transaction(async tx => {
            const [batch] = await tx.select().from(penyusutanArsip).where(and(
                scopedRecordByIdWhere(penyusutanArsip.id, id, penyusutanArsip.unitKerjaId, unitScope),
                batchSecurityCondition(securityClassifications),
            )).limit(1).for('update');
            if (!batch) throw new AppError('Penyusutan batch not found', 404);
            if (batch.jenisPenyusutan !== 'pemusnahan' || batch.status !== 'approved') {
                throw new ConflictError('Pilihan bukti tersedia untuk pemusnahan yang telah disetujui.');
            }
            actor = await lockDispositionActor(tx, actor, id, batch.unitKerjaId);
            if (actor.role !== 'super_admin') throw new ForbiddenError('Kewenangan administrator terkini diperlukan untuk memilih bukti.');
            // Reload after the parent locks; the earlier request cannot authorize stale rows.
            const archives = await tx.select({ ...getTableColumns(arsip), isTerjaga: protectedDesignation }).from(arsip)
                .innerJoin(penyusutanItems, eq(penyusutanItems.arsipId, arsip.id))
                .where(eq(penyusutanItems.penyusutanId, id)).orderBy(asc(arsip.id)).for('update', { of: arsip });
            if (!archives.length || archives.some(archive => archive.unitKerjaId !== batch.unitKerjaId
                || archive.legalHold || archive.isTerjaga || archive.disposalStatus !== 'approved' || archive.disposalBatchId !== id
                || !isAllowedArchiveClass(archive.klasifikasiKeamanan, securityClassifications))) {
                throw new ConflictError('Arsip batch tidak tersedia untuk memilih bukti pelaksanaan.');
            }
            await assertManageGrants(tx, archives, actor);
            const attachments = await tx.select().from(fileAttachments).where(and(
                eq(fileAttachments.entityType, 'arsip'), inArray(fileAttachments.entityId, archives.map((row: any) => row.id)),
            ));
            const people = await tx.select({ id: users.id, name: users.name, nip: users.nip,
                jabatan: users.jabatan, role: users.role, unitKerjaId: users.unitKerjaId })
                .from(users).where(and(eq(users.isActive, true), or(eq(users.unitKerjaId, batch.unitKerjaId), eq(users.role, 'super_admin'))));
            return { attachments: attachments.filter(item => isFileReleased(item) && item.lastFixityCheckAt
                && (item.fileUrl || item.driveFileId)).map(item => ({ id: item.id, fileName: item.fileName || 'Lampiran',
                    arsipId: item.entityId, sha256: item.sha256 })),
                witnesses: people.filter(person => person.id !== actor.id && person.name?.trim()
                    && isAllowedForRecordUnit(person, batch.unitKerjaId)),
            };
        });
    }

    async recoverInactiveTransfer(id: string, reason: string, actor: DispositionActor,
        unitScope: RecordUnitScope, securityClassifications?: string[] | null) {
        if (actor.role !== 'super_admin') throw new ForbiddenError('Peninjauan pemindahan lama memerlukan administrator berwenang.');
        const parsed = recoverInactiveTransferSchema.safeParse({ reason });
        if (!parsed.success) throw new ValidationError('Alasan peninjauan pemindahan minimal 20 karakter diperlukan.');
        return db.transaction(async tx => {
            const [batch] = await tx.select().from(penyusutanArsip).where(and(
                scopedRecordByIdWhere(penyusutanArsip.id, id, penyusutanArsip.unitKerjaId, unitScope),
                batchSecurityCondition(securityClassifications),
            )).limit(1).for('update');
            if (!batch) throw new AppError('Penyusutan batch not found', 404);
            if (batch.jenisPenyusutan !== 'pemindahan' || batch.status !== 'executed'
                || !batch.tanggalPelaksanaan || !batch.executedBy) {
                throw new ConflictError('Hanya batch pemindahan lama dengan rekam pelaksanaan lengkap dapat ditinjau.');
            }
            actor = await lockDispositionActor(tx, actor, id, batch.unitKerjaId);
            if (actor.role !== 'super_admin') throw new ForbiddenError('Kewenangan administrator terkini diperlukan untuk pemulihan.');
            if (batch.executedBy === actor.id) throw new ForbiddenError('Peninjau harus berbeda dari pelaksana pemindahan lama.');
            const rows = await tx.select({ ...getTableColumns(arsip) }).from(arsip)
                .innerJoin(penyusutanItems, eq(penyusutanItems.arsipId, arsip.id))
                .where(eq(penyusutanItems.penyusutanId, id)).orderBy(asc(arsip.id)).for('update', { of: arsip });
            if (!rows.length || rows.some(row => row.legalHold || row.unitKerjaId !== batch.unitKerjaId
                || row.disposalStatus !== 'executed' || row.disposalBatchId !== id
                || row.inactiveTransferredAt || row.inactiveTransferBatchId
                || !isAllowedArchiveClass(row.klasifikasiKeamanan, securityClassifications))) {
                throw new ConflictError('Arsip tidak dapat dipulihkan: masih ditahan, telah dipulihkan, atau telah mengikuti proses lain.');
            }
            await assertManageGrants(tx, rows, actor);
            const recovered = await tx.update(arsip).set({ disposalStatus: 'active', disposalBatchId: null,
                inactiveTransferBatchId: id,
                inactiveTransferredAt: new Date(`${batch.tanggalPelaksanaan}T00:00:00+07:00`), updatedAt: new Date() })
                .where(and(inArray(arsip.id, rows.map(row => row.id)), eq(arsip.disposalBatchId, id),
                    eq(arsip.disposalStatus, 'executed'), eq(arsip.legalHold, false)))
                .returning({ id: arsip.id });
            if (recovered.length !== rows.length) throw new ConflictError('Sebagian arsip berubah ketika dipulihkan.');
            await auditLogService.logActionOrThrow({ userId: actor.id, userEmail: actor.email, ipAddress: actor.ipAddress,
                action: 'update', entityType: 'penyusutan', entityId: id,
                changes: { operation: 'recover_inactive_transfer', reason: parsed.data.reason,
                    originalExecutorId: batch.executedBy, originalExecutionDate: batch.tanggalPelaksanaan,
                    archiveIds: rows.map(row => row.id), before: { disposalStatus: 'executed', disposalBatchId: id },
                    after: { disposalStatus: 'active', disposalBatchId: null, inactiveTransferBatchId: id } },
            }, tx);
            return { recovered: recovered.length };
        });
    }

    async addItems(
        batchId: string,
        arsipIds: string[],
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
        auditContext?: CriticalAuditContext,
    ) {
        assertArchiveIdList(arsipIds);
        return await db.transaction(async (tx: any) => {
            const batch = await tx.select().from(penyusutanArsip).where(and(
                scopedRecordByIdWhere(
                    penyusutanArsip.id,
                    batchId,
                    penyusutanArsip.unitKerjaId,
                    unitScope,
                ),
                batchSecurityCondition(securityClassifications),
            )).for('update');
            if (!batch[0]) throw new AppError('Batch not found', 404);
            assertLegacyPermanentTransferMutationAllowed(batch[0].jenisPenyusutan);
            if (batch[0].status !== 'draft') throw new ValidationError('Can only add items to draft batches');

            await this.assertArsipEligible(
                tx,
                arsipIds,
                batch[0].unitKerjaId,
                batch[0].jenisPenyusutan,
                securityClassifications,
            );

            // Get current max nomorUrut
            const existingItems = await tx.select({ nomorUrut: penyusutanItems.nomorUrut })
                .from(penyusutanItems)
                .where(eq(penyusutanItems.penyusutanId, batchId))
                .orderBy(desc(penyusutanItems.nomorUrut))
                .limit(1);
            const startNum = (existingItems[0]?.nomorUrut || 0) + 1;

            const itemsToInsert = arsipIds.map((arsipId, index) => ({
                penyusutanId: batchId,
                arsipId,
                nomorUrut: startNum + index,
            }));

            await tx.insert(penyusutanItems).values(itemsToInsert);

            // Update arsip disposal status
            const disposalStatus = JENIS_TO_DISPOSAL_STATUS[batch[0].jenisPenyusutan] || 'active';
            await tx.update(arsip)
                .set({ disposalStatus, disposalBatchId: batchId, updatedAt: new Date() })
                .where(inArray(arsip.id, arsipIds));

            // Update totals
            const countResult = await tx.select({ count: sql<number>`count(*)` })
                .from(penyusutanItems)
                .where(eq(penyusutanItems.penyusutanId, batchId));

            await tx.update(penyusutanArsip)
                .set({ totalBerkas: Number(countResult[0]?.count || 0), updatedAt: new Date() })
                .where(scopedRecordByIdWhere(
                    penyusutanArsip.id,
                    batchId,
                    penyusutanArsip.unitKerjaId,
                    unitScope,
                ));

            if (auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'update',
                    entityType: 'penyusutan',
                    entityId: batchId,
                    changes: {
                        itemsAdded: arsipIds,
                        after: { totalBerkas: Number(countResult[0]?.count || 0) },
                    },
                }, tx);
            }

            return { added: arsipIds.length };
        });
    }

    /**
     * Remove items from a draft batch
     */
    async removeItems(
        batchId: string,
        arsipIds: string[],
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
        auditContext?: CriticalAuditContext,
    ) {
        assertArchiveIdList(arsipIds);
        return await db.transaction(async (tx: any) => {
            const batch = await tx.select().from(penyusutanArsip).where(and(
                scopedRecordByIdWhere(
                    penyusutanArsip.id,
                    batchId,
                    penyusutanArsip.unitKerjaId,
                    unitScope,
                ),
                batchSecurityCondition(securityClassifications),
            )).for('update');
            if (!batch[0]) throw new AppError('Batch not found', 404);
            assertLegacyPermanentTransferMutationAllowed(batch[0].jenisPenyusutan);
            if (batch[0].status !== 'draft') throw new ValidationError('Can only remove items from draft batches');

            await tx.delete(penyusutanItems)
                .where(and(
                    eq(penyusutanItems.penyusutanId, batchId),
                    inArray(penyusutanItems.arsipId, arsipIds),
                ));

            // Reset arsip disposal status — only for arsip actually held by this batch
            await tx.update(arsip)
                .set({ disposalStatus: 'active', disposalBatchId: null, updatedAt: new Date() })
                .where(and(
                    inArray(arsip.id, arsipIds),
                    eq(arsip.disposalBatchId, batchId),
                ));

            // Update totals
            const countResult = await tx.select({ count: sql<number>`count(*)` })
                .from(penyusutanItems)
                .where(eq(penyusutanItems.penyusutanId, batchId));

            await tx.update(penyusutanArsip)
                .set({ totalBerkas: Number(countResult[0]?.count || 0), updatedAt: new Date() })
                .where(scopedRecordByIdWhere(
                    penyusutanArsip.id,
                    batchId,
                    penyusutanArsip.unitKerjaId,
                    unitScope,
                ));

            if (auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'update',
                    entityType: 'penyusutan',
                    entityId: batchId,
                    changes: {
                        itemsRemoved: arsipIds,
                        after: { totalBerkas: Number(countResult[0]?.count || 0) },
                    },
                }, tx);
            }

            return { removed: arsipIds.length };
        });
    }

    /**
     * Delete a draft batch
     */
    async deleteBatch(
        id: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
        auditContext?: CriticalAuditContext,
    ) {
        return await db.transaction(async (tx: any) => {
            const batch = await tx.select().from(penyusutanArsip).where(and(
                scopedRecordByIdWhere(
                    penyusutanArsip.id,
                    id,
                    penyusutanArsip.unitKerjaId,
                    unitScope,
                ),
                batchSecurityCondition(securityClassifications),
            )).for('update');
            if (!batch[0]) throw new AppError('Batch not found', 404);
            assertLegacyPermanentTransferMutationAllowed(batch[0].jenisPenyusutan);
            if (batch[0].status !== 'draft') throw new ValidationError('Can only delete draft batches');

            const items = await tx.select({ arsipId: penyusutanItems.arsipId })
                .from(penyusutanItems)
                .where(eq(penyusutanItems.penyusutanId, id))
                .for('update');

            const arsipIds = items.map((item: any) => item.arsipId);
            if (arsipIds.length > 0) {
                await tx.update(arsip)
                    .set({ disposalStatus: 'active', disposalBatchId: null, updatedAt: new Date() })
                    .where(and(
                        inArray(arsip.id, arsipIds),
                        eq(arsip.disposalBatchId, id),
                    ));
            }

            const [deleted] = await tx.delete(penyusutanArsip)
                .where(and(
                    scopedRecordByIdWhere(
                        penyusutanArsip.id,
                        id,
                        penyusutanArsip.unitKerjaId,
                        unitScope,
                    ),
                    eq(penyusutanArsip.status, 'draft'),
                ))
                .returning({ id: penyusutanArsip.id });
            if (!deleted) throw new ConflictError('Cannot delete: batch status changed concurrently');

            if (auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'delete',
                    entityType: 'penyusutan',
                    entityId: id,
                    changes: {
                        before: {
                            status: batch[0].status,
                            jenisPenyusutan: batch[0].jenisPenyusutan,
                            arsipIds,
                        },
                    },
                }, tx);
            }

            return { deleted: true };
        });
    }

    /**
     * Get disposal candidates based on type using existing arsipService logic
     */
    async getCandidates(
        unitKerjaId: string,
        jenisPenyusutan: string,
        securityClassifications?: string[] | null,
    ) {
        // Only get arsip that are not already in a batch
        const allArchives = await db.select({ ...ARCHIVE_WITH_RULE_SNAPSHOT_SELECT, isTerjaga: protectedDesignation })
            .from(arsip)
            .leftJoin(arsipRuleSnapshots, CURRENT_RULE_SNAPSHOT_JOIN)
            .leftJoin(retentionTriggerEvents, CURRENT_RETENTION_TRIGGER_JOIN)
            .leftJoin(retentionTriggerVerifications, CURRENT_RETENTION_VERIFICATION_JOIN)
            .leftJoin(jraAppraisalDecisions, CURRENT_APPRAISAL_DECISION_JOIN)
            .leftJoin(jraAppraisalCases, CURRENT_APPRAISAL_CASE_JOIN)
            .where(and(
                eq(arsip.unitKerjaId, unitKerjaId),
                eq(arsip.disposalStatus, 'active'),
                eq(arsip.legalHold, false),
                isNotNull(arsip.currentRetentionTriggerEventId),
                eq(arsip.ruleProvenanceStatus, 'verified'),
                isNotNull(arsip.klasifikasiArsipId),
                isNotNull(arsip.klasifikasiRuleSetId),
                isNotNull(arsip.klasifikasiSnapshotHash),
                isNotNull(arsip.jraItemId),
                isNotNull(arsip.jraRuleSetId),
                isNotNull(arsip.retentionDecisionHash),
                isNotNull(arsip.currentRuleSnapshotId),
                archiveSecurityCondition(securityClassifications),
            ));

        // Filter based on lifecycle status and hasilAkhir
        const candidates = allArchives.filter(arch => {
            if (arch.legalHold || !arch.currentRetentionTriggerEventId) return false;
            if (jenisPenyusutan === 'pemindahan' && (arch.inactiveTransferredAt || arch.inactiveTransferBatchId)) return false;
            if (jenisPenyusutan === 'pemusnahan' && arch.isTerjaga) return false;
            if (getRuleProvenanceBlockReason(arch)) return false;
            const evaluation = arsipService.evaluateCanonicalRetention(arch);
            if (!evaluation.verified) return false;
            const status = evaluation.status;
            const dispositionCode = evaluation.effectiveDispositionCode;
            const hasJraProvenance = Boolean(
                String(arch.jraKode || '').trim()
                && String(arch.jraVersion || '').trim()
                && String(arch.jraReference || '').trim()
            );

            switch (jenisPenyusutan) {
                case 'pemindahan':
                    // Archives where aktif period has expired, should be moved to Unit Kearsipan
                    return evaluation.calculationEligible
                        && evaluation.normalizedRetention?.calculationMode === 'duration'
                        && ['inaktif', 'akan_kadaluarsa', 'kadaluarsa'].includes(status);
                case 'pemusnahan':
                    return hasJraProvenance
                        && evaluation.dispositionEligible
                        && dispositionCode === 'musnah';
                case 'penyerahan':
                    return hasJraProvenance && evaluation.dispositionEligible
                        && dispositionCode === 'permanen';
                default:
                    return false;
            }
        });

        return candidates.map(arch => {
            const evaluation = arsipService.evaluateCanonicalRetention(arch);
            const {
                ruleSnapshotId: _ruleSnapshotId,
                ruleSnapshotArsipId: _ruleSnapshotArsipId,
                ruleSnapshotStatus: _ruleSnapshotStatus,
                ruleSnapshotJraItemId: _ruleSnapshotJraItemId,
                ruleSnapshotJraRuleSetId: _ruleSnapshotJraRuleSetId,
                ruleSnapshot: _ruleSnapshot,
                ruleSnapshotSha256: _ruleSnapshotSha256,
                triggerEventRecordId: _triggerEventRecordId,
                triggerEventArsipId: _triggerEventArsipId,
                triggerEventType: _triggerEventType,
                triggerEventLabel: _triggerEventLabel,
                triggerEventDate: _triggerEventDate,
                triggerEventEvidenceUri: _triggerEventEvidenceUri,
                triggerEventRevision: _triggerEventRevision,
                triggerEventActorId: _triggerEventActorId,
                triggerVerificationVerdict: _triggerVerificationVerdict,
                triggerVerifierId: _triggerVerifierId,
                latestTriggerEventRevision: _latestTriggerEventRevision,
                appraisalDecisionRecordId: _appraisalDecisionRecordId,
                appraisalDecisionArsipId: _appraisalDecisionArsipId,
                appraisalDecisionStatus: _appraisalDecisionStatus,
                appraisalDecisionOutcome: _appraisalDecisionOutcome,
                appraisalDecisionSnapshot: _appraisalDecisionSnapshot,
                appraisalDecisionSha256: _appraisalDecisionSha256,
                appraisalCaseStatus: _appraisalCaseStatus,
                hasActiveAppraisalCase: _hasActiveAppraisalCase,
                ...archive
            } = arch;
            return {
                ...archive,
                retentionTriggerType: arch.triggerEventType,
                retentionTriggerLabel: arch.triggerEventLabel,
                retentionTriggerDate: arch.triggerEventDate,
                retentionTriggerEvidence: arch.triggerEventEvidenceUri,
                retentionStatus: evaluation.status,
                tanggalKadaluarsa: evaluation.dates.tanggalKadaluarsa,
                hasilAkhir: evaluation.effectiveDispositionCode === 'musnah'
                    ? 'Musnah'
                    : evaluation.effectiveDispositionCode === 'permanen'
                        ? 'Permanen'
                        : 'Dinilai Kembali',
                canonicalRetention: evaluation,
            };
        });
    }

    /**
     * Generate Daftar Arsip Aktif data (Formulir 4)
     */
    async generateDaftarArsipAktif(
        unitKerjaId: string,
        tahun?: number,
        securityClassifications?: string[] | null,
    ) {
        const conditions = [eq(arsip.unitKerjaId, unitKerjaId)];
        if (tahun) conditions.push(eq(arsip.tahun, tahun));
        const securityCondition = archiveSecurityCondition(securityClassifications);
        if (securityCondition) conditions.push(securityCondition);

        const allArchives = await db.select(ARCHIVE_WITH_RULE_SNAPSHOT_SELECT)
            .from(arsip)
            .leftJoin(arsipRuleSnapshots, CURRENT_RULE_SNAPSHOT_JOIN)
            .leftJoin(retentionTriggerEvents, CURRENT_RETENTION_TRIGGER_JOIN)
            .leftJoin(retentionTriggerVerifications, CURRENT_RETENTION_VERIFICATION_JOIN)
            .leftJoin(jraAppraisalDecisions, CURRENT_APPRAISAL_DECISION_JOIN)
            .leftJoin(jraAppraisalCases, CURRENT_APPRAISAL_CASE_JOIN)
            .where(and(...conditions))
            .orderBy(arsip.kodeKlasifikasi, arsip.nomorBerkas);

        // Filter to aktif status only
        const aktifArchives = allArchives.filter(arch => {
            if (!arch.currentRetentionTriggerEventId) return true; // Undetermined remains active, never disposable
            const evaluation = arsipService.evaluateCanonicalRetention(arch);
            if (!evaluation.verified || !evaluation.calculationEligible) return true;
            return evaluation.status === 'belum_ditentukan'
                || evaluation.status === 'aktif'
                || evaluation.status === 'akan_inaktif';
        });

        return {
            unitKerjaId,
            tahun: tahun || new Date().getFullYear(),
            tanggalCetak: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
            totalBerkas: aktifArchives.length,
            daftarArsip: aktifArchives.map((arch, index) => ({
                no: index + 1,
                nomorBerkas: arch.nomorBerkas || '-',
                kodeKlasifikasi: arch.kodeKlasifikasi || '-',
                uraianBerkas: arch.uraianBerkas || '-',
                kurunWaktu: arch.kurunWaktu || '-',
                jumlah: arch.jumlah || 1,
                nomorItem: arch.nomorItem || '-',
                uraianItem: arch.uraianItem || '-',
                tanggalArsip: arch.tanggalArsip || '-',
                tingkatPerkembangan: arch.tingkatPerkembangan || '-',
                lokasiSimpan: [arch.lokasiFc, arch.lokasiLaci, arch.lokasiFolder].filter(Boolean).join('/') || '-',
                klasifikasiKeamanan: arch.klasifikasiKeamanan || 'Biasa',
                keterangan: arch.keterangan || '-',
            })),
        };
    }

    /**
     * Generate Daftar Arsip Inaktif data (Formulir 6)
     */
    async generateDaftarArsipInaktif(
        unitKerjaId: string,
        tahun?: number,
        securityClassifications?: string[] | null,
    ) {
        const conditions = [eq(arsip.unitKerjaId, unitKerjaId)];
        if (tahun) conditions.push(eq(arsip.tahun, tahun));
        const securityCondition = archiveSecurityCondition(securityClassifications);
        if (securityCondition) conditions.push(securityCondition);

        const allArchives = await db.select(ARCHIVE_WITH_RULE_SNAPSHOT_SELECT)
            .from(arsip)
            .leftJoin(arsipRuleSnapshots, CURRENT_RULE_SNAPSHOT_JOIN)
            .leftJoin(retentionTriggerEvents, CURRENT_RETENTION_TRIGGER_JOIN)
            .leftJoin(retentionTriggerVerifications, CURRENT_RETENTION_VERIFICATION_JOIN)
            .leftJoin(jraAppraisalDecisions, CURRENT_APPRAISAL_DECISION_JOIN)
            .leftJoin(jraAppraisalCases, CURRENT_APPRAISAL_CASE_JOIN)
            .where(and(...conditions))
            .orderBy(arsip.kodeKlasifikasi, arsip.nomorBerkas);

        // Filter to inaktif status
        const inaktifArchives = allArchives.filter(arch => {
            if (!arch.currentRetentionTriggerEventId) return false;
            const evaluation = arsipService.evaluateCanonicalRetention(arch);
            if (!evaluation.verified || !evaluation.calculationEligible) return false;
            return evaluation.status === 'inaktif'
                || evaluation.status === 'akan_kadaluarsa'
                || evaluation.status === 'kadaluarsa';
        });

        return {
            unitKerjaId,
            tahun: tahun || new Date().getFullYear(),
            tanggalCetak: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
            totalBerkas: inaktifArchives.length,
            daftarArsip: inaktifArchives.map((arch, index) => ({
                no: index + 1,
                nomorArsip: arch.nomorBerkas || '-',
                kodeKlasifikasi: arch.kodeKlasifikasi || '-',
                uraianInformasiArsip: arch.uraianBerkas || arch.uraianItem || '-',
                kurunWaktu: arch.kurunWaktu || '-',
                jumlah: arch.jumlah || 1,
                tingkatPerkembangan: arch.tingkatPerkembangan || '-',
                lokasiSimpan: [arch.lokasiFc, arch.lokasiLaci, arch.lokasiFolder].filter(Boolean).join('/') || '-',
                klasifikasiKeamanan: arch.klasifikasiKeamanan || 'Biasa',
                jangkaSimpan: `${arch.retensiAktif || '-'} / ${arch.retensiInaktif || '-'}`,
                nasibAkhir: (() => {
                    const outcome = arsipService.evaluateCanonicalRetention(arch)
                        .effectiveDispositionCode;
                    if (outcome === 'musnah') return 'Musnah';
                    if (outcome === 'permanen') return 'Permanen';
                    return 'Dinilai Kembali';
                })(),
                kategoriArsip: arch.jraKode || '-',
                keterangan: arch.keterangan || '-',
            })),
        };
    }
}

export const penyusutanService = new PenyusutanService();
