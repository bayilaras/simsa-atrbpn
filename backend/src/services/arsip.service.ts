import { db } from '../config/database';
import {
    arsip,
    NewArsip,
    Arsip,
    arsipItems,
    arsipRuleSnapshots,
    jraAppraisalCases,
    jraAppraisalDecisions,
    retentionTriggerEvents,
    retentionTriggerVerifications,
} from '../db/schema';
import { eq, and, desc, sql, ilike, or, isNotNull, isNull, ne, inArray, getTableColumns } from 'drizzle-orm';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import {
    archiveRuleAssignmentService,
    CURRENT_APPRAISAL_CASE_JOIN,
    CURRENT_APPRAISAL_DECISION_JOIN,
    CURRENT_RETENTION_TRIGGER_JOIN,
    CURRENT_RETENTION_VERIFICATION_JOIN,
    RETENTION_GOVERNANCE_EVIDENCE_SELECT,
    type ArchiveLifecycleStatus,
    type CanonicalRetentionEvidence,
    type CanonicalRetentionEvaluation,
    type StructuredRetentionRule,
} from './archive-rule-assignment.service';

export interface ArsipFilters {
    unitKerjaId?: string;
    jenisArsip?: string;
    tahun?: number;
    search?: string;
    page?: number;
    limit?: number;
    /** null means all classes (super_admin); [] fails closed. */
    securityClassifications?: string[] | null;
}

interface ArchiveRetentionMetadata {
    retentionTriggerType?: 'kegiatan_selesai' | 'berkas_ditutup' | 'serah_terima' | 'penetapan' | 'lainnya';
    retentionTriggerLabel?: string;
    retentionTriggerDate?: string;
    retentionTriggerEvidence?: string;
    jraVersion?: string;
    jraReference?: string;
}

function archiveSecurityCondition(classes: string[] | null | undefined) {
    if (classes === undefined || classes === null) return undefined;
    if (classes.length === 0) return sql`false`;
    return inArray(
        sql<string>`lower(coalesce(${arsip.klasifikasiKeamanan}, 'biasa'))`,
        classes,
    );
}

const RULE_ASSIGNMENT_FIELDS = new Set([
    'kodeKlasifikasi',
    'klasifikasiArsipId',
    'klasifikasiRuleSetId',
    'klasifikasiVersion',
    'klasifikasiReference',
    'klasifikasiSnapshotHash',
    'masaSimpanAktif',
    'masaSimpanInaktif',
    'hasilAkhir',
    'jraKode',
    'jraItemId',
    'jraRuleSetId',
    'jraUraian',
    'jraVersion',
    'jraReference',
    'retensiAktif',
    'retensiInaktif',
    'retensiKeterangan',
    'retentionDecisionHash',
    'currentRuleSnapshotId',
    'ruleProvenanceStatus',
]);

const RETENTION_TRIGGER_FIELDS = new Set([
    'retentionTriggerType',
    'retentionTriggerLabel',
    'retentionTriggerDate',
    'retentionTriggerEvidence',
]);

const SYSTEM_MANAGED_RETENTION_FIELDS = new Set([
    'disposalStatus',
    'disposalBatchId',
    'legalHold',
    'legalHoldReason',
    'legalHoldPlacedAt',
    'legalHoldPlacedBy',
    'legalHoldReleasedAt',
    'legalHoldReleasedBy',
    'legalHoldReleaseReason',
    'tanggalKadaluarsa',
]);

const ARCHIVE_WITH_RULE_SNAPSHOT = {
    ...getTableColumns(arsip),
    ruleSnapshotId: arsipRuleSnapshots.id,
    ruleSnapshotArsipId: arsipRuleSnapshots.arsipId,
    ruleSnapshotStatus: arsipRuleSnapshots.status,
    ruleSnapshotJraItemId: arsipRuleSnapshots.jraItemId,
    ruleSnapshotJraRuleSetId: arsipRuleSnapshots.jraRuleSetId,
    ruleSnapshot: arsipRuleSnapshots.snapshot,
    ruleSnapshotSha256: arsipRuleSnapshots.snapshotSha256,
    ...RETENTION_GOVERNANCE_EVIDENCE_SELECT,
};

type ArchiveWithRuleSnapshot = Arsip & CanonicalRetentionEvidence & {
    ruleSnapshotId: string | null;
    ruleSnapshotArsipId: string | null;
    ruleSnapshotStatus: string | null;
    ruleSnapshotJraItemId: number | null;
    ruleSnapshotJraRuleSetId: string | null;
    ruleSnapshot: unknown;
    ruleSnapshotSha256: string | null;
};

function withoutRuleSnapshot(row: ArchiveWithRuleSnapshot): Arsip {
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
    } = row;
    return archive as Arsip;
}

function dispositionLabel(code: string | null | undefined): Arsip['hasilAkhir'] {
    if (code === 'musnah') return 'Musnah';
    if (code === 'permanen') return 'Permanen';
    return 'Dinilai Kembali';
}

export class ArsipService {
    private assertNoDirectRetentionTrigger(data: Record<string, any>) {
        if ([
            data.retentionTriggerType,
            data.retentionTriggerLabel,
            data.retentionTriggerDate,
            data.retentionTriggerEvidence,
        ].some((value) => value !== undefined && value !== null && value !== '')) {
            throw new ValidationError(
                'Pemicu retensi tidak boleh dicatat langsung pada arsip. Gunakan workflow peristiwa retensi dan verifikasi independen setelah registrasi.',
            );
        }
        if (data.tanggalKadaluarsa !== undefined
            && data.tanggalKadaluarsa !== null
            && data.tanggalKadaluarsa !== '') {
            throw new ValidationError(
                'Tanggal kedaluwarsa hanya dihitung sistem dari snapshot JRA dan peristiwa retensi terverifikasi.',
            );
        }
        if (data.hasilAkhir !== undefined && data.hasilAkhir !== null && data.hasilAkhir !== '') {
            throw new ValidationError(
                'Hasil akhir hanya boleh berasal dari snapshot JRA atau keputusan appraisal efektif.',
            );
        }
    }

    async findAll(filters: ArsipFilters) {
        const {
            unitKerjaId,
            jenisArsip,
            tahun,
            search,
            page = 1,
            limit = 20,
            securityClassifications,
        } = filters;
        const offset = (page - 1) * limit;

        const conditions = [];

        if (unitKerjaId) {
            conditions.push(eq(arsip.unitKerjaId, unitKerjaId));
        }

        if (securityClassifications !== undefined && securityClassifications !== null) {
            conditions.push(securityClassifications.length > 0
                ? inArray(
                    sql<string>`lower(coalesce(${arsip.klasifikasiKeamanan}, 'biasa'))`,
                    securityClassifications,
                )
                : sql`false`);
        }

        if (jenisArsip) {
            conditions.push(eq(arsip.jenisArsip, jenisArsip));
        }
        if (tahun) {
            conditions.push(eq(arsip.tahun, tahun));
        }
        if (search) {
            conditions.push(
                or(
                    ilike(arsip.nomorBerkas, `%${search}%`),
                    ilike(arsip.uraianBerkas, `%${search}%`),
                    ilike(arsip.nomorSuratOriginal, `%${search}%`),
                    ilike(arsip.perihalOriginal, `%${search}%`)
                )!
            );
        }


        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(arsip)
            .where(and(...conditions));

        const rows = await db
            .select(ARCHIVE_WITH_RULE_SNAPSHOT)
            .from(arsip)
            .leftJoin(arsipRuleSnapshots, and(
                eq(arsipRuleSnapshots.id, arsip.currentRuleSnapshotId),
                eq(arsipRuleSnapshots.arsipId, arsip.id),
            ))
            .leftJoin(retentionTriggerEvents, CURRENT_RETENTION_TRIGGER_JOIN)
            .leftJoin(retentionTriggerVerifications, CURRENT_RETENTION_VERIFICATION_JOIN)
            .leftJoin(jraAppraisalDecisions, CURRENT_APPRAISAL_DECISION_JOIN)
            .leftJoin(jraAppraisalCases, CURRENT_APPRAISAL_CASE_JOIN)
            .where(and(...conditions))
            .orderBy(desc(arsip.createdAt))
            .limit(limit)
            .offset(offset);
        const data = rows.map((row) => this.toCanonicalReadModel(row as ArchiveWithRuleSnapshot));


        return {
            data,
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit),
            },
        };
    }

    async findById(id: string) {
        const [result] = await db
            .select(ARCHIVE_WITH_RULE_SNAPSHOT)
            .from(arsip)
            .leftJoin(arsipRuleSnapshots, and(
                eq(arsipRuleSnapshots.id, arsip.currentRuleSnapshotId),
                eq(arsipRuleSnapshots.arsipId, arsip.id),
            ))
            .leftJoin(retentionTriggerEvents, CURRENT_RETENTION_TRIGGER_JOIN)
            .leftJoin(retentionTriggerVerifications, CURRENT_RETENTION_VERIFICATION_JOIN)
            .leftJoin(jraAppraisalDecisions, CURRENT_APPRAISAL_DECISION_JOIN)
            .leftJoin(jraAppraisalCases, CURRENT_APPRAISAL_CASE_JOIN)
            .where(eq(arsip.id, id))
            .limit(1);

        if (!result) return null;

        // Fetch related items from arsip_items table
        const items = await db
            .select()
            .from(arsipItems)
            .where(eq(arsipItems.arsipId, id))
            .orderBy(arsipItems.nomorItem);

        return {
            ...this.toCanonicalReadModel(result as ArchiveWithRuleSnapshot),
            items,
        };
    }

    async create(data: NewArsip) {
        // Direct registration is disabled at the route. Keep this lower-level
        // method fail-closed as well: legacy display text can never create an
        // actionable expiry without a verified canonical snapshot.
        this.assertNoDirectRetentionTrigger(data);
        if (Object.keys(data).some((field) => RULE_ASSIGNMENT_FIELDS.has(field))) {
            throw new ValidationError(
                'Klasifikasi dan hasil akhir JRA wajib ditetapkan melalui registrasi bersnapshot atau rekonsiliasi aturan.',
            );
        }
        const [result] = await db
            .insert(arsip)
            .values({
                ...data,
                retentionTriggerType: null,
                retentionTriggerLabel: null,
                retentionTriggerDate: null,
                retentionTriggerEvidence: null,
                tanggalKadaluarsa: null,
            })
            .returning();

        return result;
    }

    async getRuleHistory(id: string) {
        return db
            .select()
            .from(arsipRuleSnapshots)
            .where(eq(arsipRuleSnapshots.arsipId, id))
            .orderBy(desc(arsipRuleSnapshots.revision));
    }

    async reconcileRules(
        id: string,
        unitKerjaId: string,
        selection: {
            klasifikasiItemId?: number;
            kodeKlasifikasi?: string;
            jraItemId?: number;
            jraKode?: string;
        },
        reason: string,
        userId?: string,
    ) {
        if (reason.trim().length < 10) {
            throw new ValidationError('Alasan rekonsiliasi minimal 10 karakter.');
        }

        return db.transaction(async (tx: any) => {
            const [existing] = await tx
                .select()
                .from(arsip)
                .where(and(eq(arsip.id, id), eq(arsip.unitKerjaId, unitKerjaId)))
                .limit(1)
                .for('update');

            if (!existing) throw new NotFoundError('Arsip');
            if (existing.disposalStatus === 'executed') {
                throw new ConflictError('Arsip yang penyusutannya telah dieksekusi bersifat immutable.');
            }
            if (existing.legalHold || existing.disposalStatus !== 'active' || existing.disposalBatchId) {
                throw new ConflictError(
                    'Rekonsiliasi aturan tidak dapat dilakukan saat legal hold atau setelah arsip masuk workflow penyusutan.'
                );
            }
            const [activeAppraisal] = await tx
                .select({ id: jraAppraisalCases.id })
                .from(jraAppraisalCases)
                .where(and(
                    eq(jraAppraisalCases.arsipId, id),
                    inArray(jraAppraisalCases.status, ['open', 'in_review']),
                ))
                .limit(1)
                .for('update');
            if (activeAppraisal) {
                throw new ConflictError(
                    'Rekonsiliasi aturan ditolak selama appraisal masih terbuka atau sedang ditelaah.',
                );
            }

            const assignment = await archiveRuleAssignmentService.resolveActive(tx, selection);
            if (
                existing.ruleProvenanceStatus === 'verified'
                && existing.klasifikasiArsipId === assignment.cache.klasifikasiArsipId
                && existing.jraItemId === assignment.cache.jraItemId
                && existing.klasifikasiRuleSetId === assignment.cache.klasifikasiRuleSetId
                && existing.jraRuleSetId === assignment.cache.jraRuleSetId
            ) {
                throw new ConflictError('Arsip sudah menggunakan butir klasifikasi dan JRA aktif yang dipilih.');
            }

            return archiveRuleAssignmentService.appendRevision(
                tx,
                id,
                assignment,
                reason,
                existing.retentionTriggerDate,
                userId,
            );
        });
    }

    async update(id: string, data: Partial<Arsip>) {
        const requestedFields = Object.keys(data);
        const changesRuleAssignment = requestedFields.some(field =>
            RULE_ASSIGNMENT_FIELDS.has(field),
        );
        const changesRetentionTrigger = requestedFields.some(field =>
            RETENTION_TRIGGER_FIELDS.has(field),
        );
        const changesSystemManagedState = requestedFields.some(field =>
            SYSTEM_MANAGED_RETENTION_FIELDS.has(field),
        );
        if (changesSystemManagedState) {
            throw new ValidationError(
                'Status penyusutan dan legal hold hanya dapat diubah melalui workflow khusus.'
            );
        }
        if (changesRuleAssignment) {
            throw new ValidationError(
                'Klasifikasi dan keputusan JRA hanya dapat diubah melalui rekonsiliasi aturan agar riwayat revisi tetap utuh.'
            );
        }
        if (changesRetentionTrigger) {
            throw new ValidationError(
                'Pemicu retensi hanya dapat diubah melalui workflow peristiwa retensi dan verifikasi independen.',
            );
        }

        return db.transaction(async (tx: any) => {
            const [existing] = await tx
                .select()
                .from(arsip)
                .where(eq(arsip.id, id))
                .limit(1)
                .for('update');

            if (!existing) return undefined;
            if (existing.disposalStatus === 'executed') {
                throw new ConflictError(
                    'Arsip yang penyusutannya telah dieksekusi bersifat immutable.'
                );
            }

            const [result] = await tx
                .update(arsip)
                .set({ ...data, updatedAt: new Date() })
                .where(eq(arsip.id, id))
                .returning();

            return result;
        });
    }

    async delete(id: string) {
        void id;
        throw new ConflictError(
            'Penghapusan langsung arsip dinonaktifkan. Gunakan workflow penyusutan sesuai JRA dan legal hold.'
        );
    }

    // Create arsip from surat masuk
    async archiveFromSuratMasuk(suratMasukId: string, metadata: {
        klasifikasiItemId?: number;
        jraItemId?: number;
        nomorBerkas?: string;
        kodeKlasifikasi?: string;
        uraianBerkas?: string;
        lokasiFc?: string;
        lokasiLaci?: string;
        lokasiFolder?: string;
        jraKode?: string;
        jraUraian?: string;
        retensiAktif?: string;
        retensiInaktif?: string;
        retentionTriggerType?: ArchiveRetentionMetadata['retentionTriggerType'];
        retentionTriggerLabel?: string;
        retentionTriggerDate?: string;
        retentionTriggerEvidence?: string;
        jraVersion?: string;
        jraReference?: string;
        hasilAkhir?: string;
        keterangan?: string;
        klasifikasiKeamanan?: string;
        personInCharge?: string;
        unitPengolah?: string;
        kurunWaktu?: string;
        nomorItem?: string;
        uraianItem?: string;
        tingkatPerkembangan?: string;
        tanggalArsip?: string;
        jumlah?: number;
        createdBy?: string;
    }, authorizedUnitKerjaId?: string) {
        const { suratMasuk } = await import('../db/schema');
        this.assertNoDirectRetentionTrigger(metadata);

        return await db.transaction(async (tx: any) => {
            // Get the surat masuk — locked so concurrent requests cannot both pass the
            // "already archived" check below and create duplicate arsip rows
            const [surat] = await tx
                .select()
                .from(suratMasuk)
                .where(eq(suratMasuk.id, suratMasukId))
                .limit(1)
                .for('update');

            if (!surat) {
                throw new Error('Surat masuk not found');
            }
            // Route authorization happens before this transaction. Re-check
            // the mutable source state and its authorized unit after acquiring
            // the row lock to close delete/archive and unit-transfer races.
            if (authorizedUnitKerjaId && surat.unitKerjaId !== authorizedUnitKerjaId) {
                throw new NotFoundError('Surat masuk');
            }
            if (surat.isDeleted) {
                throw new NotFoundError('Surat masuk');
            }
            if (surat.isArchived) {
                throw new ConflictError('Surat masuk sudah diarsipkan');
            }

            // Check if already archived
            const [existing] = await tx
                .select()
                .from(arsip)
                .where(and(
                    eq(arsip.sourceSuratId, suratMasukId),
                    eq(arsip.jenisArsip, 'masuk')
                ))
                .limit(1);

            if (existing) {
                throw new Error('Surat masuk sudah diarsipkan');
            }

            // Resolve both decisions against the currently published instruments.
            // Client-provided retention text/version/outcome is display-only and is
            // intentionally ignored to prevent a forged disposal decision.
            const assignment = await archiveRuleAssignmentService.resolveActive(tx, metadata);

            // Create arsip entry
            const [arsipEntry] = await tx
                .insert(arsip)
                .values({
                    unitKerjaId: surat.unitKerjaId,
                    jenisArsip: 'masuk',
                    sourceSuratId: suratMasukId,
                    tahun: surat.tahun,
                    nomorBerkas: metadata.nomorBerkas,
                    uraianBerkas: metadata.uraianBerkas || surat.perihal,
                    tanggalArsip: metadata.tanggalArsip || surat.tanggalSurat,
                    lokasiFc: metadata.lokasiFc,
                    lokasiLaci: metadata.lokasiLaci,
                    lokasiFolder: metadata.lokasiFolder,
                    retentionTriggerType: null,
                    retentionTriggerLabel: null,
                    retentionTriggerDate: null,
                    retentionTriggerEvidence: null,
                    klasifikasiKeamanan: metadata.klasifikasiKeamanan,
                    personInCharge: metadata.personInCharge,
                    unitPengolah: metadata.unitPengolah,
                    kurunWaktu: metadata.kurunWaktu,
                    nomorItem: metadata.nomorItem,
                    uraianItem: metadata.uraianItem,
                    tingkatPerkembangan: metadata.tingkatPerkembangan,
                    jumlah: metadata.jumlah,
                    keterangan: metadata.keterangan,
                    nomorSuratOriginal: surat.nomorSurat,
                    tanggalSuratOriginal: surat.tanggalSurat,
                    perihalOriginal: surat.perihal,
                    tanggalKadaluarsa: null,
                    ...assignment.cache,
                    createdBy: metadata.createdBy,
                })
                .returning();

            // Insert items into arsip_items table
            if ((metadata as any).items && Array.isArray((metadata as any).items) && (metadata as any).items.length > 0) {
                const itemsToInsert = (metadata as any).items.map((item: any) => ({
                    arsipId: arsipEntry.id,
                    nomorItem: item.nomor || item.nomorItem || '',
                    uraianItem: item.uraian || item.uraianItem || '',
                    tingkatPerkembangan: item.perkembangan || item.tingkatPerkembangan || '',
                    tanggalItem: item.tanggal || item.tanggalItem || null,
                    jumlah: item.jumlah || 1,
                    mediaType: item.mediaType || 'kertas',
                    lokasiFc: item.lokasiFc || '',
                    lokasiLaci: item.lokasiLaci || '',
                    lokasiFolder: item.lokasiFolder || '',
                }));
                await tx.insert(arsipItems).values(itemsToInsert);
            }

            // Update surat masuk isArchived flag
            await tx
                .update(suratMasuk)
                .set({ isArchived: true, updatedAt: new Date() })
                .where(eq(suratMasuk.id, suratMasukId));

            return await archiveRuleAssignmentService.attachInitialSnapshot(
                tx,
                arsipEntry.id,
                assignment,
                metadata.createdBy,
            );
        });
    }

    // Create arsip from surat keluar
    async archiveFromSuratKeluar(suratKeluarId: string, metadata: {
        klasifikasiItemId?: number;
        jraItemId?: number;
        nomorBerkas?: string;
        kodeKlasifikasi?: string;
        uraianBerkas?: string;
        lokasiFc?: string;
        lokasiLaci?: string;
        lokasiFolder?: string;
        jraKode?: string;
        jraUraian?: string;
        retensiAktif?: string;
        retensiInaktif?: string;
        retentionTriggerType?: ArchiveRetentionMetadata['retentionTriggerType'];
        retentionTriggerLabel?: string;
        retentionTriggerDate?: string;
        retentionTriggerEvidence?: string;
        jraVersion?: string;
        jraReference?: string;
        hasilAkhir?: string;
        keterangan?: string;
        klasifikasiKeamanan?: string;
        personInCharge?: string;
        unitPengolah?: string;
        kurunWaktu?: string;
        nomorItem?: string;
        uraianItem?: string;
        tingkatPerkembangan?: string;
        tanggalArsip?: string;
        jumlah?: number;
        createdBy?: string;
    }, authorizedUnitKerjaId?: string) {
        const { suratKeluar } = await import('../db/schema');
        this.assertNoDirectRetentionTrigger(metadata);

        return await db.transaction(async (tx: any) => {
            // Get the surat keluar — locked so concurrent requests cannot both pass the
            // "already archived" check below and create duplicate arsip rows
            const [surat] = await tx
                .select()
                .from(suratKeluar)
                .where(eq(suratKeluar.id, suratKeluarId))
                .limit(1)
                .for('update');

            if (!surat) {
                throw new Error('Surat keluar not found');
            }
            if (authorizedUnitKerjaId && surat.unitKerjaId !== authorizedUnitKerjaId) {
                throw new NotFoundError('Surat keluar');
            }
            if (surat.isDeleted) {
                throw new NotFoundError('Surat keluar');
            }
            if (surat.isArchived) {
                throw new ConflictError('Surat keluar sudah diarsipkan');
            }

            // Check if already archived
            const [existing] = await tx
                .select()
                .from(arsip)
                .where(and(
                    eq(arsip.sourceSuratId, suratKeluarId),
                    eq(arsip.jenisArsip, 'keluar')
                ))
                .limit(1);

            if (existing) {
                throw new Error('Surat keluar sudah diarsipkan');
            }

            const assignment = await archiveRuleAssignmentService.resolveActive(tx, metadata);

            // Create arsip entry
            const [arsipEntry] = await tx
                .insert(arsip)
                .values({
                    unitKerjaId: surat.unitKerjaId,
                    jenisArsip: 'keluar',
                    sourceSuratId: suratKeluarId,
                    tahun: surat.tahun,
                    nomorBerkas: metadata.nomorBerkas,
                    uraianBerkas: metadata.uraianBerkas || surat.perihal,
                    tanggalArsip: metadata.tanggalArsip || surat.tanggalSurat,
                    lokasiFc: metadata.lokasiFc,
                    lokasiLaci: metadata.lokasiLaci,
                    lokasiFolder: metadata.lokasiFolder,
                    retentionTriggerType: null,
                    retentionTriggerLabel: null,
                    retentionTriggerDate: null,
                    retentionTriggerEvidence: null,
                    klasifikasiKeamanan: metadata.klasifikasiKeamanan,
                    personInCharge: metadata.personInCharge,
                    unitPengolah: metadata.unitPengolah,
                    kurunWaktu: metadata.kurunWaktu,
                    nomorItem: metadata.nomorItem,
                    uraianItem: metadata.uraianItem,
                    tingkatPerkembangan: metadata.tingkatPerkembangan,
                    jumlah: metadata.jumlah,
                    keterangan: metadata.keterangan,
                    nomorSuratOriginal: surat.nomorSurat,
                    tanggalSuratOriginal: surat.tanggalSurat,
                    perihalOriginal: surat.perihal,
                    tanggalKadaluarsa: null,
                    ...assignment.cache,
                    createdBy: metadata.createdBy,
                })
                .returning();

            // Insert items into arsip_items table
            if ((metadata as any).items && Array.isArray((metadata as any).items) && (metadata as any).items.length > 0) {
                const itemsToInsert = (metadata as any).items.map((item: any) => ({
                    arsipId: arsipEntry.id,
                    nomorItem: item.nomor || item.nomorItem || '',
                    uraianItem: item.uraian || item.uraianItem || '',
                    tingkatPerkembangan: item.perkembangan || item.tingkatPerkembangan || '',
                    tanggalItem: item.tanggal || item.tanggalItem || null,
                    jumlah: item.jumlah || 1,
                    mediaType: item.mediaType || 'kertas',
                    lokasiFc: item.lokasiFc || '',
                    lokasiLaci: item.lokasiLaci || '',
                    lokasiFolder: item.lokasiFolder || '',
                }));
                await tx.insert(arsipItems).values(itemsToInsert);
            }

            // Update surat keluar isArchived flag
            await tx
                .update(suratKeluar)
                .set({ isArchived: true, updatedAt: new Date() })
                .where(eq(suratKeluar.id, suratKeluarId));

            return await archiveRuleAssignmentService.attachInitialSnapshot(
                tx,
                arsipEntry.id,
                assignment,
                metadata.createdBy,
            );
        });
    }

    // Find arsip by source surat id
    async findBySourceSurat(sourceSuratId: string) {
        const [result] = await db
            .select(ARCHIVE_WITH_RULE_SNAPSHOT)
            .from(arsip)
            .leftJoin(arsipRuleSnapshots, and(
                eq(arsipRuleSnapshots.id, arsip.currentRuleSnapshotId),
                eq(arsipRuleSnapshots.arsipId, arsip.id),
            ))
            .leftJoin(retentionTriggerEvents, CURRENT_RETENTION_TRIGGER_JOIN)
            .leftJoin(retentionTriggerVerifications, CURRENT_RETENTION_VERIFICATION_JOIN)
            .leftJoin(jraAppraisalDecisions, CURRENT_APPRAISAL_DECISION_JOIN)
            .leftJoin(jraAppraisalCases, CURRENT_APPRAISAL_CASE_JOIN)
            .where(eq(arsip.sourceSuratId, sourceSuratId))
            .limit(1);

        return result
            ? this.toCanonicalReadModel(result as ArchiveWithRuleSnapshot)
            : null;
    }

    // Get arsip with source surat details
    async findByIdWithSourceSurat(id: string) {
        const arsipEntry = await this.findById(id);
        if (!arsipEntry || !arsipEntry.sourceSuratId) return arsipEntry;

        let sourceSurat = null;

        if (arsipEntry.jenisArsip === 'masuk') {
            const { suratMasuk } = await import('../db/schema');
            const [surat] = await db
                .select()
                .from(suratMasuk)
                .where(eq(suratMasuk.id, arsipEntry.sourceSuratId))
                .limit(1);
            sourceSurat = surat || null;
        } else if (arsipEntry.jenisArsip === 'keluar') {
            const { suratKeluar } = await import('../db/schema');
            const [surat] = await db
                .select()
                .from(suratKeluar)
                .where(eq(suratKeluar.id, arsipEntry.sourceSuratId))
                .limit(1);
            sourceSurat = surat || null;
        }

        return {
            ...arsipEntry,
            sourceSurat,
        };
    }

    /** Evaluate lifecycle state from the archive's immutable current snapshot. */
    evaluateCanonicalRetention(row: Partial<ArchiveWithRuleSnapshot>): CanonicalRetentionEvaluation {
        return archiveRuleAssignmentService.evaluateCanonicalRetention(
            row.retentionTriggerDate,
            {
                arsipId: row.id,
                ruleProvenanceStatus: row.ruleProvenanceStatus,
                currentRuleSnapshotId: row.currentRuleSnapshotId,
                jraItemId: row.jraItemId,
                jraRuleSetId: row.jraRuleSetId,
                retentionDecisionHash: row.retentionDecisionHash,
                snapshotId: row.ruleSnapshotId,
                snapshotArsipId: row.ruleSnapshotArsipId,
                snapshotStatus: row.ruleSnapshotStatus,
                snapshotJraItemId: row.ruleSnapshotJraItemId,
                snapshotJraRuleSetId: row.ruleSnapshotJraRuleSetId,
                snapshot: row.ruleSnapshot,
                snapshotSha256: row.ruleSnapshotSha256,
                currentRetentionTriggerEventId: row.currentRetentionTriggerEventId,
                triggerEventRecordId: row.triggerEventRecordId,
                triggerEventArsipId: row.triggerEventArsipId,
                triggerEventDate: row.triggerEventDate,
                triggerEventRevision: row.triggerEventRevision,
                triggerEventActorId: row.triggerEventActorId,
                triggerVerificationVerdict: row.triggerVerificationVerdict,
                triggerVerifierId: row.triggerVerifierId,
                latestTriggerEventRevision: row.latestTriggerEventRevision,
                currentAppraisalDecisionId: row.currentAppraisalDecisionId,
                appraisalDecisionRecordId: row.appraisalDecisionRecordId,
                appraisalDecisionArsipId: row.appraisalDecisionArsipId,
                appraisalDecisionStatus: row.appraisalDecisionStatus,
                appraisalDecisionOutcome: row.appraisalDecisionOutcome,
                appraisalDecisionSnapshot: row.appraisalDecisionSnapshot,
                appraisalDecisionSha256: row.appraisalDecisionSha256,
                appraisalCaseStatus: row.appraisalCaseStatus,
                hasActiveAppraisalCase: row.hasActiveAppraisalCase,
            },
        );
    }

    /**
     * Public archive reads expose the raw columns only as compatibility fields.
     * Their values are replaced from verified evidence, while canonicalRetention
     * makes the authority and any fail-closed reason explicit to clients.
     */
    private toCanonicalReadModel(row: ArchiveWithRuleSnapshot) {
        const canonicalRetention = this.evaluateCanonicalRetention(row);
        const archive = withoutRuleSnapshot(row);
        const displayDisposition = canonicalRetention.effectiveDispositionCode
            || canonicalRetention.normalizedRetention?.dispositionCode
            || null;
        return {
            ...archive,
            retentionTriggerType: canonicalRetention.verified
                ? (row.triggerEventType as Arsip['retentionTriggerType'])
                : null,
            retentionTriggerLabel: canonicalRetention.verified ? row.triggerEventLabel : null,
            retentionTriggerDate: canonicalRetention.verified ? row.triggerEventDate : null,
            retentionTriggerEvidence: canonicalRetention.verified
                ? row.triggerEventEvidenceUri
                : null,
            tanggalKadaluarsa: canonicalRetention.verified
                ? canonicalRetention.dates.tanggalKadaluarsa
                : null,
            hasilAkhir: canonicalRetention.verified && displayDisposition
                ? dispositionLabel(displayDisposition)
                : null,
            canonicalRetention,
        };
    }

    // Get arsip that will expire within N days
    async getExpiring(
        unitKerjaId?: string | null,
        daysAhead: number = 30,
        securityClassifications?: string[] | null,
    ) {
        const today = new Date();
        const futureDate = new Date();
        futureDate.setDate(today.getDate() + daysAhead);

        const rows = await db
            .select(ARCHIVE_WITH_RULE_SNAPSHOT)
            .from(arsip)
            .leftJoin(arsipRuleSnapshots, and(
                eq(arsipRuleSnapshots.id, arsip.currentRuleSnapshotId),
                eq(arsipRuleSnapshots.arsipId, arsip.id),
            ))
            .leftJoin(retentionTriggerEvents, CURRENT_RETENTION_TRIGGER_JOIN)
            .leftJoin(retentionTriggerVerifications, CURRENT_RETENTION_VERIFICATION_JOIN)
            .leftJoin(jraAppraisalDecisions, CURRENT_APPRAISAL_DECISION_JOIN)
            .leftJoin(jraAppraisalCases, CURRENT_APPRAISAL_CASE_JOIN)
            .where(and(
                unitKerjaId ? eq(arsip.unitKerjaId, unitKerjaId) : undefined,
                archiveSecurityCondition(securityClassifications),
                eq(arsip.legalHold, false),
                eq(arsip.ruleProvenanceStatus, 'verified'),
                isNotNull(arsip.currentRetentionTriggerEventId)
            ));

        const todayIso = today.toISOString().slice(0, 10);
        const futureIso = futureDate.toISOString().slice(0, 10);
        return rows.flatMap(row => {
            // The cache check is only an additional fail-closed invariant; all
            // dates and eligibility below still come from canonical evidence.
            if (row.legalHold || !row.retentionTriggerDate) return [];
            const evaluation = this.evaluateCanonicalRetention(row as ArchiveWithRuleSnapshot);
            const expiry = evaluation.dates.tanggalKadaluarsa;
            if (!evaluation.verified || !evaluation.calculationEligible || !expiry) return [];
            if (expiry < todayIso || expiry > futureIso) return [];
            const displayDisposition = evaluation.effectiveDispositionCode
                || evaluation.normalizedRetention?.dispositionCode;
            return [{
                ...withoutRuleSnapshot(row as ArchiveWithRuleSnapshot),
                tanggalKadaluarsa: expiry,
                hasilAkhir: displayDisposition ? dispositionLabel(displayDisposition) : null,
                canonicalRetention: evaluation,
            }];
        }).sort((a, b) => String(a.tanggalKadaluarsa).localeCompare(String(b.tanggalKadaluarsa)));
    }

    async getLegalHolds(unitKerjaId: string, securityClassifications?: string[] | null) {
        return db
            .select()
            .from(arsip)
            .where(and(
                eq(arsip.unitKerjaId, unitKerjaId),
                archiveSecurityCondition(securityClassifications),
                eq(arsip.legalHold, true),
            ))
            .orderBy(desc(arsip.legalHoldPlacedAt), desc(arsip.updatedAt));
    }

    async placeLegalHold(id: string, unitKerjaId: string, reason: string, userId?: string) {
        if (reason.trim().length < 10) {
            throw new ValidationError('Alasan legal hold minimal 10 karakter.');
        }
        const [existing] = await db
            .select()
            .from(arsip)
            .where(and(eq(arsip.id, id), eq(arsip.unitKerjaId, unitKerjaId)))
            .limit(1);

        if (!existing) throw new NotFoundError('Arsip');
        if (existing.legalHold) throw new ConflictError('Arsip sudah dalam status legal hold.');
        if (existing.disposalStatus === 'executed') {
            throw new ConflictError('Legal hold tidak dapat diterapkan setelah penyusutan selesai dieksekusi.');
        }

        const [updated] = await db
            .update(arsip)
            .set({
                legalHold: true,
                legalHoldReason: reason.trim(),
                legalHoldPlacedAt: new Date(),
                legalHoldPlacedBy: userId || null,
                legalHoldReleasedAt: null,
                legalHoldReleasedBy: null,
                legalHoldReleaseReason: null,
                updatedAt: new Date(),
            })
            .where(and(
                eq(arsip.id, id),
                eq(arsip.unitKerjaId, unitKerjaId),
                eq(arsip.legalHold, false),
                or(
                    isNull(arsip.disposalStatus),
                    ne(arsip.disposalStatus, 'executed'),
                ),
            ))
            .returning();

        if (!updated) throw new ConflictError('Status legal hold berubah. Muat ulang data dan coba kembali.');
        return { before: existing, after: updated };
    }

    async releaseLegalHold(id: string, unitKerjaId: string, reason: string, userId?: string) {
        if (reason.trim().length < 10) {
            throw new ValidationError('Alasan pelepasan legal hold minimal 10 karakter.');
        }
        const [existing] = await db
            .select()
            .from(arsip)
            .where(and(eq(arsip.id, id), eq(arsip.unitKerjaId, unitKerjaId)))
            .limit(1);

        if (!existing) throw new NotFoundError('Arsip');
        if (!existing.legalHold) throw new ConflictError('Arsip tidak sedang dalam status legal hold.');

        const [updated] = await db
            .update(arsip)
            .set({
                legalHold: false,
                legalHoldReleasedAt: new Date(),
                legalHoldReleasedBy: userId || null,
                legalHoldReleaseReason: reason.trim(),
                updatedAt: new Date(),
            })
            .where(and(
                eq(arsip.id, id),
                eq(arsip.unitKerjaId, unitKerjaId),
                eq(arsip.legalHold, true),
            ))
            .returning();

        if (!updated) throw new ConflictError('Status legal hold berubah. Muat ulang data dan coba kembali.');
        return { before: existing, after: updated };
    }

    async getStats(
        unitKerjaId: string,
        tahun?: number,
        securityClassifications?: string[] | null,
    ) {
        const conditions = [
            eq(arsip.unitKerjaId, unitKerjaId),
            archiveSecurityCondition(securityClassifications),
        ];
        if (tahun) {
            conditions.push(eq(arsip.tahun, tahun));
        }

        const stats = await db
            .select({
                total: sql<number>`count(*)::int`,
                arsipMasuk: sql<number>`count(*) filter (where ${arsip.jenisArsip} = 'masuk')::int`,
                arsipKeluar: sql<number>`count(*) filter (where ${arsip.jenisArsip} = 'keluar')::int`,
            })
            .from(arsip)
            .where(and(...conditions));

        return stats[0];
    }

    calculateRetentionDates(
        retentionTriggerDate: string | null,
        normalizedOrLegacyText: StructuredRetentionRule | string | null,
        _legacyInactiveText?: string | null,
    ) {
        // String arguments are retained only for binary/source compatibility
        // with older callers. They deliberately fail closed instead of parsing.
        const normalized = normalizedOrLegacyText !== null
            && typeof normalizedOrLegacyText === 'object'
            ? normalizedOrLegacyText
            : null;
        return archiveRuleAssignmentService.calculateRetentionDates(
            retentionTriggerDate,
            normalized,
        );
    }

    getArchiveStatus(
        retentionTriggerDate: string | null,
        normalizedOrLegacyText: StructuredRetentionRule | string | null,
        legacyInactiveOrNow?: string | null | Date,
    ): ArchiveLifecycleStatus {
        const normalized = normalizedOrLegacyText !== null
            && typeof normalizedOrLegacyText === 'object'
            ? normalizedOrLegacyText
            : null;
        const now = legacyInactiveOrNow instanceof Date ? legacyInactiveOrNow : new Date();
        return archiveRuleAssignmentService.getArchiveStatus(
            retentionTriggerDate,
            normalized,
            now,
        );
    }

    // Get lifecycle notifications for all archives in unit
    async getLifecycleNotifications(
        unitKerjaId: string,
        securityClassifications?: string[] | null,
    ) {
        // Keep held/missing-trigger counts visible, but never mix them into actionable
        // lifecycle collections.
        const rows = await db
            .select(ARCHIVE_WITH_RULE_SNAPSHOT)
            .from(arsip)
            .leftJoin(arsipRuleSnapshots, and(
                eq(arsipRuleSnapshots.id, arsip.currentRuleSnapshotId),
                eq(arsipRuleSnapshots.arsipId, arsip.id),
            ))
            .leftJoin(retentionTriggerEvents, CURRENT_RETENTION_TRIGGER_JOIN)
            .leftJoin(retentionTriggerVerifications, CURRENT_RETENTION_VERIFICATION_JOIN)
            .leftJoin(jraAppraisalDecisions, CURRENT_APPRAISAL_DECISION_JOIN)
            .leftJoin(jraAppraisalCases, CURRENT_APPRAISAL_CASE_JOIN)
            .where(and(
                eq(arsip.unitKerjaId, unitKerjaId),
                archiveSecurityCondition(securityClassifications),
            ));

        const notifications = {
            willBeInactive: [] as Arsip[],      // Akan memasuki masa inaktif
            alreadyInactive: [] as Arsip[],     // Sudah inaktif
            willExpire: [] as Arsip[],          // Akan kadaluarsa (30 hari)
            expired: [] as Arsip[],             // Sudah kadaluarsa, perlu action
        };
        let held = 0;
        let missingTrigger = 0;
        let unverifiedRules = 0;
        let manualReview = 0;

        for (const row of rows as ArchiveWithRuleSnapshot[]) {
            const arch = withoutRuleSnapshot(row);
            if (arch.legalHold) {
                held += 1;
                continue;
            }
            if (arch.ruleProvenanceStatus !== 'verified') {
                unverifiedRules += 1;
                continue;
            }
            if (!row.currentRetentionTriggerEventId) {
                missingTrigger += 1;
                continue;
            }

            const evaluation = this.evaluateCanonicalRetention(row);
            if (!evaluation.verified) {
                unverifiedRules += 1;
                continue;
            }
            if (!evaluation.calculationEligible) {
                manualReview += 1;
                continue;
            }
            const status = evaluation.status;
            const canonicalArchive = {
                ...arch,
                tanggalKadaluarsa: evaluation.dates.tanggalKadaluarsa,
                hasilAkhir: dispositionLabel(
                    evaluation.effectiveDispositionCode
                    || evaluation.normalizedRetention?.dispositionCode,
                ),
                canonicalRetention: evaluation,
            };

            switch (status) {
                case 'akan_inaktif':
                    notifications.willBeInactive.push(canonicalArchive);
                    break;
                case 'inaktif':
                    notifications.alreadyInactive.push(canonicalArchive);
                    break;
                case 'akan_kadaluarsa':
                    notifications.willExpire.push(canonicalArchive);
                    break;
                case 'kadaluarsa':
                    notifications.expired.push(canonicalArchive);
                    break;
            }
        }

        return {
            ...notifications,
            summary: {
                willBeInactive: notifications.willBeInactive.length,
                alreadyInactive: notifications.alreadyInactive.length,
                willExpire: notifications.willExpire.length,
                expired: notifications.expired.length,
                held,
                missingTrigger,
                unverifiedRules,
                manualReview,
                total: rows.length,
            }
        };
    }

    // Get disposal candidates grouped by hasilAkhir
    async getDisposalCandidates(unitKerjaId: string, filters?: {
        hasilAkhir?: 'Musnah' | 'Permanen' | 'Dinilai Kembali';
        status?: 'kadaluarsa' | 'akan_kadaluarsa' | 'inaktif';
        page?: number;
        limit?: number;
        /** null means all classes (super_admin); [] fails closed. */
        securityClassifications?: string[] | null;
    }) {
        const {
            hasilAkhir,
            status,
            page = 1,
            limit = 20,
            securityClassifications,
        } = filters || {};
        const offset = (page - 1) * limit;

        const conditions = [
            eq(arsip.unitKerjaId, unitKerjaId),
            eq(arsip.disposalStatus, 'active'),
            eq(arsip.legalHold, false),
            eq(arsip.ruleProvenanceStatus, 'verified'),
            isNotNull(arsip.currentRetentionTriggerEventId),
            archiveSecurityCondition(securityClassifications),
        ];
        const rows = await db
            .select(ARCHIVE_WITH_RULE_SNAPSHOT)
            .from(arsip)
            .leftJoin(arsipRuleSnapshots, and(
                eq(arsipRuleSnapshots.id, arsip.currentRuleSnapshotId),
                eq(arsipRuleSnapshots.arsipId, arsip.id),
            ))
            .leftJoin(retentionTriggerEvents, CURRENT_RETENTION_TRIGGER_JOIN)
            .leftJoin(retentionTriggerVerifications, CURRENT_RETENTION_VERIFICATION_JOIN)
            .leftJoin(jraAppraisalDecisions, CURRENT_APPRAISAL_DECISION_JOIN)
            .leftJoin(jraAppraisalCases, CURRENT_APPRAISAL_CASE_JOIN)
            .where(and(...conditions))
            .orderBy(arsip.tanggalKadaluarsa);

        // Recalculate only from the verified current snapshot. Legacy text and
        // stale cached expiry/outcome fields are never authoritative here.
        const evaluatedArchives = (rows as ArchiveWithRuleSnapshot[]).flatMap(row => {
            const arch = withoutRuleSnapshot(row);
            if (arch.legalHold) return [];
            const evaluation = this.evaluateCanonicalRetention(row);
            if (!evaluation.verified
                || (!evaluation.calculationEligible
                    && evaluation.effectiveDecisionSource !== 'appraisal')) return [];
            const dispositionCode = evaluation.effectiveDispositionCode
                || evaluation.normalizedRetention?.dispositionCode;
            const canonicalOutcome = dispositionLabel(dispositionCode);
            if (hasilAkhir && canonicalOutcome !== hasilAkhir) return [];
            return [{
                ...arch,
                hasilAkhir: canonicalOutcome,
                canonicalDispositionCode: dispositionCode,
                canonicalDecisionSource: evaluation.effectiveDecisionSource,
                canonicalAppraisalDecisionId: evaluation.effectiveAppraisalDecisionId,
                dispositionEligible: evaluation.dispositionEligible,
                dispositionBlockReason: evaluation.dispositionBlockReason,
                retentionStatus: evaluation.status,
                tanggalKadaluarsa: evaluation.dates.tanggalKadaluarsa,
            }];
        });

        // Filter by lifecycle status
        let filteredArchives = evaluatedArchives;
        if (status) {
            filteredArchives = evaluatedArchives.filter(arch => arch.retentionStatus === status);
        } else {
            filteredArchives = evaluatedArchives.filter(arch =>
                arch.retentionStatus === 'kadaluarsa' || arch.retentionStatus === 'akan_kadaluarsa',
            );
        }

        const grouped = {
            musnah: filteredArchives.filter(a => a.canonicalDispositionCode === 'musnah'),
            permanen: filteredArchives.filter(a => a.canonicalDispositionCode === 'permanen'),
            dinilaiKembali: filteredArchives.filter(a =>
                a.canonicalDispositionCode === 'manual_review'
                || a.canonicalDispositionCode === 'dinilai_kembali',
            ),
            belumDitentukan: filteredArchives.filter(a => !a.hasilAkhir),
        };

        const paginatedData = filteredArchives.slice(offset, offset + limit);

        return {
            data: paginatedData,
            grouped,
            pagination: { page, limit, total: filteredArchives.length, totalPages: Math.ceil(filteredArchives.length / limit) },
            summary: {
                totalMusnah: grouped.musnah.length,
                totalPermanen: grouped.permanen.length,
                totalDinilaiKembali: grouped.dinilaiKembali.length,
                totalBelumDitentukan: grouped.belumDitentukan.length,
            }
        };
    }

    // Get monthly retention summary for dashboard
    async getRetentionSummary(
        unitKerjaId: string,
        securityClassifications?: string[] | null,
    ) {
        const lifecycle = await this.getLifecycleNotifications(
            unitKerjaId,
            securityClassifications,
        );

        const expiredByHasilAkhir = {
            musnah: lifecycle.expired.filter(a => a.hasilAkhir === 'Musnah').length,
            permanen: lifecycle.expired.filter(a => a.hasilAkhir === 'Permanen').length,
            dinilaiKembali: lifecycle.expired.filter(a => a.hasilAkhir === 'Dinilai Kembali').length,
            belumDitentukan: lifecycle.expired.filter(a => !a.hasilAkhir).length,
        };

        const currentMonth = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

        return {
            bulan: currentMonth,
            summary: lifecycle.summary,
            expiredByHasilAkhir,
            message: lifecycle.summary.expired > 0
                ? `Bulan ini ada ${lifecycle.summary.expired} berkas yang sudah habis masa retensinya dan perlu ditindaklanjuti.`
                : 'Tidak ada arsip yang kadaluarsa bulan ini.',
            alertLevel: lifecycle.summary.expired > 50 ? 'high' : lifecycle.summary.expired > 20 ? 'medium' : lifecycle.summary.expired > 0 ? 'low' : 'none',
        };
    }

    // Generate disposal report data
    async generateDisposalReportData(
        unitKerjaId: string,
        archiveIds?: string[],
        securityClassifications?: string[] | null,
    ) {
        const requestedIds = archiveIds && archiveIds.length > 0
            ? [...new Set(archiveIds)]
            : undefined;
        const rows = await db
            .select(ARCHIVE_WITH_RULE_SNAPSHOT)
            .from(arsip)
            .leftJoin(arsipRuleSnapshots, and(
                eq(arsipRuleSnapshots.id, arsip.currentRuleSnapshotId),
                eq(arsipRuleSnapshots.arsipId, arsip.id),
            ))
            .leftJoin(retentionTriggerEvents, CURRENT_RETENTION_TRIGGER_JOIN)
            .leftJoin(retentionTriggerVerifications, CURRENT_RETENTION_VERIFICATION_JOIN)
            .leftJoin(jraAppraisalDecisions, CURRENT_APPRAISAL_DECISION_JOIN)
            .leftJoin(jraAppraisalCases, CURRENT_APPRAISAL_CASE_JOIN)
            .where(and(
                eq(arsip.unitKerjaId, unitKerjaId),
                archiveSecurityCondition(securityClassifications),
            ));

        const selectedArchives = requestedIds
            ? (rows as ArchiveWithRuleSnapshot[]).filter(a => requestedIds.includes(a.id))
            : rows as ArchiveWithRuleSnapshot[];

        if (requestedIds) {
            const foundIds = new Set(selectedArchives.map(a => a.id));
            const missingIds = requestedIds.filter(id => !foundIds.has(id));
            if (missingIds.length > 0) {
                throw new ValidationError('Sebagian arsip tidak ditemukan pada unit kerja yang dipilih.');
            }
        }

        const archives = selectedArchives.flatMap(row => {
            if (row.legalHold || row.ruleProvenanceStatus !== 'verified'
                || row.disposalStatus !== 'active') return [];
            const evaluation = this.evaluateCanonicalRetention(row);
            if (!evaluation.verified
                || !evaluation.dispositionEligible
                || evaluation.effectiveDispositionCode !== 'musnah') return [];
            return [{
                ...withoutRuleSnapshot(row),
                hasilAkhir: 'Musnah' as const,
                tanggalKadaluarsa: evaluation.dates.tanggalKadaluarsa,
            }];
        });
        if (requestedIds && archives.length !== selectedArchives.length) {
            throw new ValidationError(
                'Berita acara hanya dapat dibuat untuk arsip Musnah yang retensinya telah berakhir, memiliki pemicu, tidak di-hold, dan belum masuk proses penyusutan.',
            );
        }

        const now = new Date();
        const reportNumber = `BA-${unitKerjaId}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;

        return {
            reportNumber,
            tanggal: now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
            unitKerja: unitKerjaId,
            totalBerkas: archives.length,
            daftarArsip: archives.map((arch, index) => ({
                no: index + 1,
                nomorBerkas: arch.nomorBerkas || '-',
                kodeKlasifikasi: arch.kodeKlasifikasi || '-',
                uraian: arch.uraianBerkas || arch.uraianItem || '-',
                kurunWaktu: arch.kurunWaktu || '-',
                jumlah: arch.jumlah || 1,
                tingkatPerkembangan: arch.tingkatPerkembangan || '-',
                jraKode: arch.jraKode || '-',
                retensiAktif: arch.retensiAktif || '-',
                retensiInaktif: arch.retensiInaktif || '-',
                retentionTriggerType: arch.retentionTriggerType || '-',
                retentionTriggerLabel: arch.retentionTriggerLabel || '-',
                retentionTriggerDate: arch.retentionTriggerDate || '-',
                retentionTriggerEvidence: arch.retentionTriggerEvidence || '-',
                jraVersion: arch.jraVersion || '-',
                jraReference: arch.jraReference || '-',
                hasilAkhir: arch.hasilAkhir || '-',
                keterangan: arch.keterangan || '-',
            })),
        };
    }
}

export const arsipService = new ArsipService();


