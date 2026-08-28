import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../config/database';
import type { Role } from '../config/permissions';
import { canAccessUnit, UNIT_KERJA_ACCESS } from '../config/permissions';
import {
    arsip,
    arsipItemRetentionDecisions,
    arsipItems,
    arsipRuleSnapshots,
    auditLog,
    fileAttachments,
    jraAppraisalCases,
    jraAppraisalDecisions,
    jraAppraisalEvidence,
    permanentTransferCancellationRequests,
    permanentTransferEvents,
    permanentTransferManifestItems,
    permanentTransferManifests,
    recordAccessGrants,
    retentionTriggerEvents,
    retentionTriggerVerifications,
    type RetentionOutcome,
} from '../db/schema';
import {
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
} from '../utils/errors';
import type {
    AddAppraisalEvidenceInput,
    CreateAppraisalCaseInput,
    CreatePermanentTransferManifestInput,
    CreateRetentionTriggerEventInput,
    PermanentTransferEventInput,
    RequestPermanentTransferCancellationInput,
    ReviewPermanentTransferCancellationInput,
} from '../validators/retention-governance.schemas';
import { archiveRuleAssignmentService } from './archive-rule-assignment.service';
import { isFileReleased } from './file-release-policy';
import { recordAccessService, type RecordUser } from './record-access.service';

export interface RetentionGovernanceActor extends RecordUser {
    id: string;
    email?: string | null;
    ipAddress?: string | null;
}

type Executor = any;
type TransferEventType = 'handover' | 'acknowledgement';

const REVIEWER_ROLES = new Set(['super_admin', 'admin_dirjen', 'admin_sesditjen']);

function canonicalJson(value: unknown): string {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(',')}}`;
}

export function canonicalSha256(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function recordObject(value: unknown): Record<string, any> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : null;
}

export function derivePermanentTransferStatus(
    eventTypes: string[],
    cancellationStatuses: string[] = [],
): 'draft' | 'cancellation_pending' | 'cancelled' | 'handed_over' | 'acknowledged' {
    if (eventTypes.includes('acknowledgement')) return 'acknowledged';
    if (eventTypes.includes('handover')) return 'handed_over';
    if (cancellationStatuses.includes('approved')) return 'cancelled';
    if (cancellationStatuses.includes('pending')) return 'cancellation_pending';
    return 'draft';
}

/**
 * Permanen at file level is the conservative ceiling: its child components
 * cannot be downgraded. Manual appraisal may otherwise resolve each component
 * independently, including an explicit Permanen exception in a Musnah series.
 */
export function validateItemOutcomeHierarchy(
    parentOutcome: RetentionOutcome,
    children: Array<{ outcome: RetentionOutcome }>,
): void {
    if (
        parentOutcome === 'permanen'
        && children.some((item) => item.outcome !== 'permanen')
    ) {
        throw new ValidationError(
            'Komponen dari berkas Permanen tidak dapat diturunkan menjadi Musnah atau Dinilai Kembali.',
        );
    }
}

function isUniqueViolation(error: unknown): boolean {
    return Boolean(
        error
        && typeof error === 'object'
        && 'code' in error
        && (error as { code?: unknown }).code === '23505',
    );
}

async function withUniqueConflict<T>(operation: () => Promise<T>, message: string): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (isUniqueViolation(error)) throw new ConflictError(message);
        throw error;
    }
}

function assertReviewer(actor: RetentionGovernanceActor): void {
    if (!REVIEWER_ROLES.has(actor.role || '')) {
        throw new ForbiddenError('Keputusan wajib dilakukan pejabat penelaah yang berwenang.');
    }
}

function assertUnitAccess(actor: RetentionGovernanceActor, unitKerjaId: string): void {
    if (!actor.role || !canAccessUnit(actor.role as Role, actor.unitKerjaId || null, unitKerjaId)) {
        throw new NotFoundError('Rekod tata kelola retensi');
    }
}

async function assertArchiveAccess(
    actor: RetentionGovernanceActor,
    arsipId: string,
    mutation: boolean,
) {
    const access = await recordAccessService.check(actor, 'arsip', arsipId);
    if (!access.exists || !access.allowed || !access.unitKerjaId) {
        throw new NotFoundError('Arsip');
    }
    // Controlled records need a purpose-bound manage grant for a governance
    // mutation. Ordinary records have no grant and remain governed by role/unit.
    if (mutation && access.grantId && access.grantAccessMode !== 'manage') {
        throw new ForbiddenError('Akses kelola diperlukan untuk mengubah tata kelola arsip terkendali.');
    }
    return access;
}

async function audit(
    executor: Executor,
    actor: RetentionGovernanceActor,
    action: string,
    entityType: string,
    entityId: string,
    changes: Record<string, unknown>,
): Promise<void> {
    // Deliberately part of the same transaction as the legal state change.
    // An audit failure therefore rolls the operation back instead of leaving an
    // unaudited appraisal/verification/transfer decision.
    await executor.insert(auditLog).values({
        userId: actor.id,
        userEmail: actor.email || null,
        action,
        entityType,
        entityId,
        changes,
        ipAddress: actor.ipAddress || null,
    });
}

async function lockArchive(executor: Executor, arsipId: string) {
    const [record] = await executor
        .select({
            id: arsip.id,
            unitKerjaId: arsip.unitKerjaId,
            kodeKlasifikasi: arsip.kodeKlasifikasi,
            klasifikasiKeamanan: arsip.klasifikasiKeamanan,
            currentRuleSnapshotId: arsip.currentRuleSnapshotId,
            ruleProvenanceStatus: arsip.ruleProvenanceStatus,
            jraItemId: arsip.jraItemId,
            jraRuleSetId: arsip.jraRuleSetId,
            jraKode: arsip.jraKode,
            jraUraian: arsip.jraUraian,
            retentionDecisionHash: arsip.retentionDecisionHash,
            currentRetentionTriggerEventId: arsip.currentRetentionTriggerEventId,
            retentionTriggerType: arsip.retentionTriggerType,
            retentionTriggerLabel: arsip.retentionTriggerLabel,
            retentionTriggerDate: arsip.retentionTriggerDate,
            retentionTriggerEvidence: arsip.retentionTriggerEvidence,
            tanggalKadaluarsa: arsip.tanggalKadaluarsa,
            currentAppraisalDecisionId: arsip.currentAppraisalDecisionId,
            legalHold: arsip.legalHold,
            disposalStatus: arsip.disposalStatus,
            disposalBatchId: arsip.disposalBatchId,
        })
        .from(arsip)
        .where(eq(arsip.id, arsipId))
        .limit(1)
        .for('update');
    if (!record) throw new NotFoundError('Arsip');
    return record;
}

function assertVerifiedRuleContext(record: Awaited<ReturnType<typeof lockArchive>>): void {
    if (
        record.ruleProvenanceStatus !== 'verified'
        || !record.currentRuleSnapshotId
        || !record.jraItemId
        || !record.jraRuleSetId
        || !/^[0-9a-f]{64}$/.test(record.retentionDecisionHash || '')
    ) {
        throw new ConflictError(
            'Appraisal memerlukan snapshot klasifikasi dan JRA yang sudah terverifikasi.',
        );
    }
}

async function assertItemsBelongToArchive(
    executor: Executor,
    arsipId: string,
    itemIds: string[],
) {
    if (itemIds.length === 0) return [];
    if (new Set(itemIds).size !== itemIds.length) {
        throw new ValidationError('Komponen arsip duplikat tidak diperbolehkan.');
    }
    const rows = await executor
        .select()
        .from(arsipItems)
        .where(and(
            eq(arsipItems.arsipId, arsipId),
            inArray(arsipItems.id, itemIds),
        ))
        .orderBy(asc(arsipItems.nomorItem));
    if (rows.length !== itemIds.length) {
        throw new ValidationError('Satu atau lebih komponen bukan bagian dari arsip yang dinilai.');
    }
    return rows;
}

function unitCondition(actor: RetentionGovernanceActor) {
    const role = actor.role as Role;
    const configured = UNIT_KERJA_ACCESS[role];
    if (configured === '*') return undefined;
    if (role === 'staff' || role === 'auditor') {
        return eq(arsip.unitKerjaId, actor.unitKerjaId || '');
    }
    if (!Array.isArray(configured) || configured.length === 0) return sql`false`;
    return inArray(arsip.unitKerjaId, configured);
}

function purposeBoundListAccessCondition(actor: RetentionGovernanceActor) {
    if (!actor.id) return sql`false`;
    const normalizedClass = sql`lower(coalesce(${arsip.klasifikasiKeamanan}, 'biasa'))`;
    return sql`(
        ${normalizedClass} = 'biasa'
        OR EXISTS (
            SELECT 1
            FROM ${recordAccessGrants} access_grant
            WHERE access_grant.target_user_id = ${actor.id}
              AND access_grant.entity_type = 'arsip'
              AND access_grant.entity_id = ${arsip.id}
              AND access_grant.unit_kerja_id = ${arsip.unitKerjaId}
              AND access_grant.required_classification = ${normalizedClass}
              AND access_grant.status = 'approved'
              AND access_grant.expires_at > now()
        )
    )`;
}

function manifestUnitCondition(actor: RetentionGovernanceActor) {
    const role = actor.role as Role;
    const configured = UNIT_KERJA_ACCESS[role];
    if (configured === '*') return undefined;
    if (role === 'staff' || role === 'auditor') {
        return eq(permanentTransferManifests.unitKerjaId, actor.unitKerjaId || '');
    }
    if (!Array.isArray(configured) || configured.length === 0) return sql`false`;
    return inArray(permanentTransferManifests.unitKerjaId, configured);
}

function permanentTransferStatusSql() {
    return sql<string>`CASE
        WHEN EXISTS (
            SELECT 1 FROM permanent_transfer_events transfer_ack
            WHERE transfer_ack.manifest_id = ${permanentTransferManifests.id}
              AND transfer_ack.event_type = 'acknowledgement'
        ) THEN 'acknowledged'
        WHEN EXISTS (
            SELECT 1 FROM permanent_transfer_events transfer_handover
            WHERE transfer_handover.manifest_id = ${permanentTransferManifests.id}
              AND transfer_handover.event_type = 'handover'
        ) THEN 'handed_over'
        WHEN EXISTS (
            SELECT 1 FROM permanent_transfer_cancellation_requests cancellation_approved
            WHERE cancellation_approved.manifest_id = ${permanentTransferManifests.id}
              AND cancellation_approved.status = 'approved'
        ) THEN 'cancelled'
        WHEN EXISTS (
            SELECT 1 FROM permanent_transfer_cancellation_requests cancellation_pending
            WHERE cancellation_pending.manifest_id = ${permanentTransferManifests.id}
              AND cancellation_pending.status = 'pending'
        ) THEN 'cancellation_pending'
        ELSE 'draft'
    END`;
}

async function getCaseForActor(
    actor: RetentionGovernanceActor,
    caseId: string,
    mutation = false,
) {
    const [record] = await db
        .select()
        .from(jraAppraisalCases)
        .where(eq(jraAppraisalCases.id, caseId))
        .limit(1);
    if (!record) throw new NotFoundError('Kasus appraisal JRA');
    await assertArchiveAccess(actor, record.arsipId, mutation);
    return record;
}

async function getManifestForActor(actor: RetentionGovernanceActor, manifestId: string) {
    const [manifest] = await db
        .select()
        .from(permanentTransferManifests)
        .where(eq(permanentTransferManifests.id, manifestId))
        .limit(1);
    if (!manifest) throw new NotFoundError('Manifest penyerahan');
    assertUnitAccess(actor, manifest.unitKerjaId);
    return manifest;
}

type PermanentTransferStatus =
    | 'draft'
    | 'cancellation_pending'
    | 'cancelled'
    | 'handed_over'
    | 'acknowledged';

const CONTROLLED_ATTACHMENT_URI = /^attachment:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function controlledAttachmentId(uri: string): string {
    const match = CONTROLLED_ATTACHMENT_URI.exec(uri.trim());
    if (!match) {
        throw new ValidationError(
            'Bukti transfer wajib memakai lampiran arsip terkendali (attachment:<UUID>).',
        );
    }
    return match[1].toLowerCase();
}

export function isEligiblePermanentTransferAttachment(
    attachment: {
        entityType?: string | null;
        entityId?: string | null;
        storageAccess?: string | null;
        sha256?: string | null;
        integrityStatus?: string | null;
        malwareScanStatus?: string | null;
        lastFixityCheckAt?: Date | string | null;
        fileUrl?: string | null;
        driveFileId?: string | null;
    } | null | undefined,
    expectedSha256: string,
    allowedArchiveIds: string[],
): boolean {
    return Boolean(
        attachment
        && attachment.entityType === 'arsip'
        && Boolean(attachment.entityId && allowedArchiveIds.includes(attachment.entityId))
        && isFileReleased(attachment)
        && attachment.lastFixityCheckAt
        && attachment.sha256?.toLowerCase() === expectedSha256.toLowerCase()
        && (attachment.fileUrl || attachment.driveFileId),
    );
}

async function assertReleasedTransferAttachment(
    executor: Executor,
    uri: string,
    expectedSha256: string,
    allowedArchiveIds: string[],
) {
    const attachmentId = controlledAttachmentId(uri);
    const [attachment] = await executor.select()
        .from(fileAttachments)
        .where(eq(fileAttachments.id, attachmentId))
        .limit(1)
        .for('update');
    if (!isEligiblePermanentTransferAttachment(attachment, expectedSha256, allowedArchiveIds)) {
        throw new ConflictError(
            'Lampiran bukti harus milik arsip dalam manifest, private, bersih, dan lolos verifikasi fixity SHA-256.',
        );
    }
    return attachment;
}

async function assertCurrentPermanentArchiveContext(
    executor: Executor,
    archive: Awaited<ReturnType<typeof lockArchive>>,
    appraisalDecisionId: string,
) {
    assertVerifiedRuleContext(archive);
    if (!archive.currentRetentionTriggerEventId) {
        throw new ConflictError(`Arsip ${archive.id} belum memiliki pemicu retensi terverifikasi.`);
    }
    if (archive.currentAppraisalDecisionId !== appraisalDecisionId) {
        throw new ConflictError(
            `Keputusan appraisal untuk arsip ${archive.id} bukan lagi keputusan efektif saat ini.`,
        );
    }

    const [snapshot] = await executor.select()
        .from(arsipRuleSnapshots)
        .where(and(
            eq(arsipRuleSnapshots.id, archive.currentRuleSnapshotId!),
            eq(arsipRuleSnapshots.arsipId, archive.id),
        ))
        .limit(1);
    const [triggerEvent] = await executor.select()
        .from(retentionTriggerEvents)
        .where(and(
            eq(retentionTriggerEvents.id, archive.currentRetentionTriggerEventId),
            eq(retentionTriggerEvents.arsipId, archive.id),
        ))
        .limit(1);
    const [triggerVerification] = await executor.select()
        .from(retentionTriggerVerifications)
        .where(eq(retentionTriggerVerifications.eventId, archive.currentRetentionTriggerEventId))
        .limit(1);
    const [latestTrigger] = await executor.select({ revision: retentionTriggerEvents.revision })
        .from(retentionTriggerEvents)
        .where(eq(retentionTriggerEvents.arsipId, archive.id))
        .orderBy(desc(retentionTriggerEvents.revision))
        .limit(1);
    const [decision] = await executor.select()
        .from(jraAppraisalDecisions)
        .where(and(
            eq(jraAppraisalDecisions.id, appraisalDecisionId),
            eq(jraAppraisalDecisions.arsipId, archive.id),
        ))
        .limit(1)
        .for('update');
    const [appraisalCase] = decision
        ? await executor.select()
            .from(jraAppraisalCases)
            .where(eq(jraAppraisalCases.id, decision.caseId))
            .limit(1)
        : [];
    const [successor] = decision
        ? await executor.select({ id: jraAppraisalDecisions.id })
            .from(jraAppraisalDecisions)
            .where(and(
                eq(jraAppraisalDecisions.supersedesDecisionId, decision.id),
                eq(jraAppraisalDecisions.decisionStatus, 'approved'),
            ))
            .limit(1)
        : [];
    const [activeAppraisal] = await executor.select({ id: jraAppraisalCases.id })
        .from(jraAppraisalCases)
        .where(and(
            eq(jraAppraisalCases.arsipId, archive.id),
            inArray(jraAppraisalCases.status, ['open', 'in_review']),
        ))
        .limit(1);

    if (
        !snapshot
        || snapshot.status !== 'verified'
        || canonicalSha256(snapshot.snapshot) !== snapshot.snapshotSha256
        || !triggerEvent
        || !triggerVerification
        || triggerVerification.verdict !== 'verified'
        || triggerVerification.verifierId === triggerEvent.actorId
        || latestTrigger?.revision !== triggerEvent.revision
        || !decision
        || decision.decisionStatus !== 'approved'
        || decision.outcome !== 'permanen'
        || !appraisalCase
        || appraisalCase.status !== 'approved'
        || canonicalSha256(decision.decisionSnapshot) !== decision.decisionSha256
        || successor
    ) {
        throw new ConflictError(
            `Konteks aturan, pemicu, atau keputusan Permanen arsip ${archive.id} tidak lagi sah.`,
        );
    }

    const evaluation = archiveRuleAssignmentService.evaluateCanonicalRetention(
        archive.retentionTriggerDate,
        {
            arsipId: archive.id,
            ruleProvenanceStatus: archive.ruleProvenanceStatus,
            currentRuleSnapshotId: archive.currentRuleSnapshotId,
            jraItemId: archive.jraItemId,
            jraRuleSetId: archive.jraRuleSetId,
            retentionDecisionHash: archive.retentionDecisionHash,
            snapshotId: snapshot.id,
            snapshotArsipId: snapshot.arsipId,
            snapshotStatus: snapshot.status,
            snapshotJraItemId: snapshot.jraItemId,
            snapshotJraRuleSetId: snapshot.jraRuleSetId,
            snapshot: snapshot.snapshot,
            snapshotSha256: snapshot.snapshotSha256,
            currentRetentionTriggerEventId: archive.currentRetentionTriggerEventId,
            triggerEventRecordId: triggerEvent.id,
            triggerEventArsipId: triggerEvent.arsipId,
            triggerEventType: triggerEvent.eventType,
            triggerEventLabel: triggerEvent.label,
            triggerEventDate: triggerEvent.eventDate,
            triggerEventEvidenceUri: triggerEvent.evidenceUri,
            triggerEventRevision: triggerEvent.revision,
            triggerEventActorId: triggerEvent.actorId,
            triggerVerificationVerdict: triggerVerification.verdict,
            triggerVerifierId: triggerVerification.verifierId,
            latestTriggerEventRevision: latestTrigger?.revision || null,
            currentAppraisalDecisionId: archive.currentAppraisalDecisionId,
            appraisalDecisionRecordId: decision.id,
            appraisalDecisionArsipId: decision.arsipId,
            appraisalDecisionStatus: decision.decisionStatus,
            appraisalDecisionOutcome: decision.outcome,
            appraisalDecisionSnapshot: decision.decisionSnapshot,
            appraisalDecisionSha256: decision.decisionSha256,
            appraisalCaseStatus: appraisalCase.status,
            hasActiveAppraisalCase: Boolean(activeAppraisal),
        },
    );
    if (
        !evaluation.verified
        || !evaluation.dispositionEligible
        || evaluation.effectiveDispositionCode !== 'permanen'
        || evaluation.effectiveAppraisalDecisionId !== appraisalDecisionId
    ) {
        throw new ConflictError(
            `Arsip ${archive.id} belum layak diserahkan permanen: ${evaluation.dispositionBlockReason || evaluation.blockReason || 'konteks keputusan belum efektif'}.`,
        );
    }
    return { snapshot, triggerEvent, triggerVerification, decision, appraisalCase, evaluation };
}

async function lockAndAssertManifestItems(
    executor: Executor,
    manifestId: string,
) {
    const items = await executor.select()
        .from(permanentTransferManifestItems)
        .where(eq(permanentTransferManifestItems.manifestId, manifestId))
        .orderBy(asc(permanentTransferManifestItems.arsipId))
        .for('update');
    if (items.length === 0) {
        throw new ConflictError('Manifest tidak memiliki arsip untuk diserahterimakan.');
    }
    const archiveRows = [];
    const archiveIds = [...new Set<string>(
        items.map((item: any) => String(item.arsipId)),
    )].sort();
    for (const arsipId of archiveIds) {
        archiveRows.push(await lockArchive(executor, arsipId));
    }
    const archivesById = new Map(archiveRows.map((row) => [row.id, row]));
    for (const item of items) {
        const archive = archivesById.get(item.arsipId)!;
        if (
            archive.legalHold
            || archive.disposalStatus !== 'proposed_serah'
            || archive.disposalBatchId !== manifestId
        ) {
            throw new ConflictError(
                `Reservasi arsip ${archive.id} berubah atau arsip sedang dalam legal hold.`,
            );
        }
        await assertCurrentPermanentArchiveContext(executor, archive, item.appraisalDecisionId);
        const attachment = await assertReleasedTransferAttachment(
            executor,
            item.objectUri,
            item.objectSha256,
            [archive.id],
        );
        if (
            item.evidenceAttachmentId !== attachment.id
            || !item.evidenceVerifiedAt
        ) {
            throw new ConflictError(`Snapshot fixity objek arsip ${archive.id} tidak lengkap.`);
        }
    }
    return { items, archives: archiveRows };
}

export class RetentionGovernanceService {
    async listAppraisals(
        actor: RetentionGovernanceActor,
        filters: {
            status?: 'open' | 'in_review' | 'approved' | 'rejected';
            arsipId?: string;
            page: number;
            limit: number;
        },
    ) {
        const conditions = [];
        const scope = unitCondition(actor);
        if (scope) conditions.push(scope);
        conditions.push(purposeBoundListAccessCondition(actor));
        if (filters.status) conditions.push(eq(jraAppraisalCases.status, filters.status));
        if (filters.arsipId) conditions.push(eq(jraAppraisalCases.arsipId, filters.arsipId));
        const where = and(...conditions);

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(jraAppraisalCases)
            .innerJoin(arsip, eq(jraAppraisalCases.arsipId, arsip.id))
            .where(where);
        const data = await db
            .select({
                id: jraAppraisalCases.id,
                arsipId: jraAppraisalCases.arsipId,
                caseType: jraAppraisalCases.caseType,
                status: jraAppraisalCases.status,
                proposedOutcome: jraAppraisalCases.proposedOutcome,
                assessorId: jraAppraisalCases.assessorId,
                submittedAt: jraAppraisalCases.submittedAt,
                reviewerId: jraAppraisalCases.reviewerId,
                reviewedAt: jraAppraisalCases.reviewedAt,
                createdAt: jraAppraisalCases.createdAt,
                appraisalDecisionId: sql<string | null>`(
                    SELECT decision_lookup.id
                    FROM jra_appraisal_decisions decision_lookup
                    WHERE decision_lookup.case_id = ${jraAppraisalCases.id}
                      AND decision_lookup.decision_status = 'approved'
                    ORDER BY decision_lookup.created_at DESC
                    LIMIT 1
                )`,
                unitKerjaId: arsip.unitKerjaId,
                nomorBerkas: arsip.nomorBerkas,
                uraianBerkas: arsip.uraianBerkas,
                jraKode: arsip.jraKode,
            })
            .from(jraAppraisalCases)
            .innerJoin(arsip, eq(jraAppraisalCases.arsipId, arsip.id))
            .where(where)
            .orderBy(desc(jraAppraisalCases.createdAt))
            .limit(filters.limit)
            .offset((filters.page - 1) * filters.limit);
        return {
            data,
            pagination: {
                page: filters.page,
                limit: filters.limit,
                total: count,
                totalPages: Math.ceil(count / filters.limit),
            },
        };
    }

    async getAppraisal(actor: RetentionGovernanceActor, caseId: string) {
        const appraisalCase = await getCaseForActor(actor, caseId);
        const [evidence, decisions] = await Promise.all([
            db.select()
                .from(jraAppraisalEvidence)
                .where(eq(jraAppraisalEvidence.caseId, caseId))
                .orderBy(asc(jraAppraisalEvidence.createdAt)),
            db.select()
                .from(jraAppraisalDecisions)
                .where(eq(jraAppraisalDecisions.caseId, caseId))
                .orderBy(asc(jraAppraisalDecisions.createdAt)),
        ]);
        const decisionIds = decisions.map((decision) => decision.id);
        const itemDecisions = decisionIds.length > 0
            ? await db.select()
                .from(arsipItemRetentionDecisions)
                .where(inArray(arsipItemRetentionDecisions.decisionId, decisionIds))
                .orderBy(asc(arsipItemRetentionDecisions.createdAt))
            : [];
        return { ...appraisalCase, evidence, decisions, itemDecisions };
    }

    async createAppraisal(
        actor: RetentionGovernanceActor,
        input: CreateAppraisalCaseInput,
    ) {
        await assertArchiveAccess(actor, input.arsipId, true);
        validateItemOutcomeHierarchy(input.proposedOutcome, input.itemDecisions);
        if (input.caseType === 'conditional_exception' && input.itemDecisions.length === 0) {
            throw new ValidationError('Appraisal pengecualian bersyarat wajib menyebut komponen arsip.');
        }

        return withUniqueConflict(() => db.transaction(async (tx) => {
            const archive = await lockArchive(tx, input.arsipId);
            assertVerifiedRuleContext(archive);
            assertUnitAccess(actor, archive.unitKerjaId);
            if (archive.legalHold || archive.disposalStatus !== 'active' || archive.disposalBatchId) {
                throw new ConflictError(
                    'Appraisal tidak dapat dibuat saat legal hold atau setelah arsip masuk workflow penyusutan.',
                );
            }
            const [active] = await tx
                .select({ id: jraAppraisalCases.id })
                .from(jraAppraisalCases)
                .where(and(
                    eq(jraAppraisalCases.arsipId, input.arsipId),
                    inArray(jraAppraisalCases.status, ['open', 'in_review']),
                ))
                .limit(1)
                .for('update');
            if (active) {
                throw new ConflictError('Arsip masih memiliki kasus appraisal yang belum selesai.');
            }

            await assertItemsBelongToArchive(
                tx,
                input.arsipId,
                input.itemDecisions.map((item) => item.arsipItemId),
            );
            const [created] = await tx.insert(jraAppraisalCases).values({
                arsipId: input.arsipId,
                caseType: input.caseType,
                status: 'open',
                reason: input.reason,
                proposedOutcome: input.proposedOutcome,
                proposedRationale: input.proposedRationale,
                proposedItemDecisions: input.itemDecisions,
                assessorId: actor.id,
            }).returning();

            await audit(tx, actor, 'appraisal_create', 'jra_appraisal', created.id, {
                arsipId: created.arsipId,
                caseType: created.caseType,
                proposedOutcome: created.proposedOutcome,
                itemDecisionCount: input.itemDecisions.length,
            });
            return created;
        }), 'Arsip masih memiliki kasus appraisal yang belum selesai.');
    }

    async addAppraisalEvidence(
        actor: RetentionGovernanceActor,
        caseId: string,
        input: AddAppraisalEvidenceInput,
    ) {
        const existing = await getCaseForActor(actor, caseId, true);
        if (existing.assessorId !== actor.id) {
            throw new ForbiddenError('Hanya assessor kasus yang dapat menambah bukti.');
        }

        return db.transaction(async (tx) => {
            const [appraisalCase] = await tx
                .select()
                .from(jraAppraisalCases)
                .where(eq(jraAppraisalCases.id, caseId))
                .limit(1)
                .for('update');
            if (!appraisalCase || appraisalCase.status !== 'open') {
                throw new ConflictError('Bukti hanya dapat ditambahkan saat kasus masih terbuka.');
            }
            if (appraisalCase.assessorId !== actor.id) {
                throw new ForbiddenError('Hanya assessor kasus yang dapat menambah bukti.');
            }
            const [created] = await tx.insert(jraAppraisalEvidence).values({
                caseId,
                label: input.label,
                evidenceUri: input.evidenceUri,
                evidenceSha256: input.evidenceSha256,
                mediaType: input.mediaType || null,
                createdBy: actor.id,
            }).returning();
            await audit(tx, actor, 'appraisal_evidence', 'jra_appraisal', caseId, {
                evidenceId: created.id,
                label: created.label,
                evidenceSha256: created.evidenceSha256,
            });
            return created;
        });
    }

    async submitAppraisal(actor: RetentionGovernanceActor, caseId: string) {
        const existing = await getCaseForActor(actor, caseId, true);
        if (existing.assessorId !== actor.id) {
            throw new ForbiddenError('Hanya assessor kasus yang dapat mengajukan penelaahan.');
        }

        return db.transaction(async (tx) => {
            const archive = await lockArchive(tx, existing.arsipId);
            const [appraisalCase] = await tx
                .select()
                .from(jraAppraisalCases)
                .where(eq(jraAppraisalCases.id, caseId))
                .limit(1)
                .for('update');
            if (!appraisalCase || appraisalCase.status !== 'open') {
                throw new ConflictError('Kasus bukan lagi berstatus open.');
            }
            if (appraisalCase.assessorId !== actor.id) {
                throw new ForbiddenError('Hanya assessor kasus yang dapat mengajukan penelaahan.');
            }

            assertVerifiedRuleContext(archive);
            if (archive.legalHold || archive.disposalStatus !== 'active' || archive.disposalBatchId) {
                throw new ConflictError(
                    'Appraisal tidak dapat diajukan saat legal hold atau setelah arsip masuk workflow penyusutan.',
                );
            }
            const evidence = await tx.select()
                .from(jraAppraisalEvidence)
                .where(eq(jraAppraisalEvidence.caseId, caseId))
                .orderBy(asc(jraAppraisalEvidence.createdAt));
            if (evidence.length === 0) {
                throw new ValidationError('Minimal satu bukti ber-hash wajib dilampirkan.');
            }
            const itemRows = await assertItemsBelongToArchive(
                tx,
                appraisalCase.arsipId,
                appraisalCase.proposedItemDecisions.map((item) => item.arsipItemId),
            );
            validateItemOutcomeHierarchy(
                appraisalCase.proposedOutcome,
                appraisalCase.proposedItemDecisions,
            );

            const [ruleSnapshot] = await tx.select()
                .from(arsipRuleSnapshots)
                .where(and(
                    eq(arsipRuleSnapshots.id, archive.currentRuleSnapshotId!),
                    eq(arsipRuleSnapshots.arsipId, archive.id),
                ))
                .limit(1);
            const snapshotRetention = recordObject(recordObject(ruleSnapshot?.snapshot)?.retention);
            if (!ruleSnapshot || ruleSnapshot.status !== 'verified'
                || canonicalSha256(ruleSnapshot.snapshot) !== ruleSnapshot.snapshotSha256
                || !snapshotRetention
                || canonicalSha256(snapshotRetention) !== archive.retentionDecisionHash) {
                throw new ConflictError('Snapshot aturan arsip tidak ditemukan atau tidak terverifikasi.');
            }

            const [latestEvent] = await tx.select()
                .from(retentionTriggerEvents)
                .where(eq(retentionTriggerEvents.arsipId, archive.id))
                .orderBy(desc(retentionTriggerEvents.revision))
                .limit(1);
            const [eventVerification] = latestEvent
                ? await tx.select()
                    .from(retentionTriggerVerifications)
                    .where(eq(retentionTriggerVerifications.eventId, latestEvent.id))
                    .limit(1)
                : [];
            if (!archive.currentRetentionTriggerEventId
                || latestEvent?.id !== archive.currentRetentionTriggerEventId
                || eventVerification?.verdict !== 'verified'
                || !eventVerification.verifierId
                || eventVerification.verifierId === latestEvent.actorId) {
                throw new ConflictError(
                    'Appraisal hanya dapat diajukan terhadap peristiwa retensi terbaru yang telah diverifikasi secara independen.',
                );
            }
            const submittedAt = new Date();
            const submissionSnapshot = {
                schemaVersion: 1,
                case: {
                    id: appraisalCase.id,
                    type: appraisalCase.caseType,
                    reason: appraisalCase.reason,
                    proposedOutcome: appraisalCase.proposedOutcome,
                    proposedRationale: appraisalCase.proposedRationale,
                    proposedItemDecisions: appraisalCase.proposedItemDecisions,
                    assessorId: appraisalCase.assessorId,
                },
                archive: {
                    id: archive.id,
                    unitKerjaId: archive.unitKerjaId,
                    kodeKlasifikasi: archive.kodeKlasifikasi,
                    jraItemId: archive.jraItemId,
                    jraRuleSetId: archive.jraRuleSetId,
                    jraKode: archive.jraKode,
                    jraUraian: archive.jraUraian,
                    retentionDecisionHash: archive.retentionDecisionHash,
                    legalHold: archive.legalHold,
                },
                ruleSnapshot: {
                    id: ruleSnapshot.id,
                    revision: ruleSnapshot.revision,
                    sha256: ruleSnapshot.snapshotSha256,
                    snapshot: ruleSnapshot.snapshot,
                },
                components: itemRows,
                evidence: evidence.map((item: any) => ({
                    id: item.id,
                    label: item.label,
                    uri: item.evidenceUri,
                    sha256: item.evidenceSha256,
                    mediaType: item.mediaType,
                    createdBy: item.createdBy,
                    createdAt: item.createdAt,
                })),
                retentionTrigger: latestEvent ? {
                    event: latestEvent,
                    verification: eventVerification || null,
                } : null,
                submittedAt,
            };
            const submissionSha256 = canonicalSha256(submissionSnapshot);
            const [updated] = await tx.update(jraAppraisalCases).set({
                status: 'in_review',
                submissionSnapshot,
                submissionSha256,
                submittedAt,
                updatedAt: submittedAt,
            }).where(and(
                eq(jraAppraisalCases.id, caseId),
                eq(jraAppraisalCases.status, 'open'),
            )).returning();
            if (!updated) throw new ConflictError('Status kasus berubah. Muat ulang data.');

            await audit(tx, actor, 'appraisal_submit', 'jra_appraisal', caseId, {
                submissionSha256,
                evidenceCount: evidence.length,
                itemDecisionCount: appraisalCase.proposedItemDecisions.length,
            });
            return updated;
        });
    }

    async approveAppraisal(
        actor: RetentionGovernanceActor,
        caseId: string,
        reason: string,
    ) {
        return this.finalizeAppraisal(actor, caseId, 'approved', reason);
    }

    async rejectAppraisal(
        actor: RetentionGovernanceActor,
        caseId: string,
        reason: string,
    ) {
        return this.finalizeAppraisal(actor, caseId, 'rejected', reason);
    }

    private async finalizeAppraisal(
        actor: RetentionGovernanceActor,
        caseId: string,
        decisionStatus: 'approved' | 'rejected',
        reason: string,
    ) {
        assertReviewer(actor);
        const existing = await getCaseForActor(actor, caseId, true);
        if (existing.assessorId === actor.id) {
            throw new ForbiddenError('Assessor tidak boleh menelaah keputusannya sendiri.');
        }

        return withUniqueConflict(() => db.transaction(async (tx) => {
            const archive = await lockArchive(tx, existing.arsipId);
            assertUnitAccess(actor, archive.unitKerjaId);
            const [appraisalCase] = await tx.select()
                .from(jraAppraisalCases)
                .where(eq(jraAppraisalCases.id, caseId))
                .limit(1)
                .for('update');
            if (!appraisalCase || appraisalCase.status !== 'in_review') {
                throw new ConflictError('Kasus sudah diproses atau belum diajukan.');
            }
            if (appraisalCase.assessorId === actor.id) {
                throw new ForbiddenError('Assessor tidak boleh menelaah keputusannya sendiri.');
            }
            if (!appraisalCase.submissionSnapshot || !appraisalCase.submissionSha256) {
                throw new ConflictError('Snapshot pengajuan appraisal tidak lengkap.');
            }
            if (canonicalSha256(appraisalCase.submissionSnapshot) !== appraisalCase.submissionSha256) {
                throw new ConflictError('Hash snapshot pengajuan appraisal tidak valid.');
            }

            if (decisionStatus === 'approved') {
                assertVerifiedRuleContext(archive);
                if (archive.legalHold || archive.disposalStatus !== 'active' || archive.disposalBatchId) {
                    throw new ConflictError(
                        'Appraisal tidak dapat disetujui saat legal hold atau setelah arsip masuk workflow penyusutan.',
                    );
                }
                const submission = recordObject(appraisalCase.submissionSnapshot);
                const submittedArchive = recordObject(submission?.archive);
                const submittedRule = recordObject(submission?.ruleSnapshot);
                const submittedTrigger = recordObject(submission?.retentionTrigger);
                const submittedEvent = recordObject(submittedTrigger?.event);
                const submittedVerification = recordObject(submittedTrigger?.verification);

                const [ruleSnapshot] = await tx.select()
                    .from(arsipRuleSnapshots)
                    .where(and(
                        eq(arsipRuleSnapshots.id, archive.currentRuleSnapshotId!),
                        eq(arsipRuleSnapshots.arsipId, archive.id),
                    ))
                    .limit(1);
                const [currentEvent] = archive.currentRetentionTriggerEventId
                    ? await tx.select()
                        .from(retentionTriggerEvents)
                        .where(and(
                            eq(retentionTriggerEvents.id, archive.currentRetentionTriggerEventId),
                            eq(retentionTriggerEvents.arsipId, archive.id),
                        ))
                        .limit(1)
                    : [];
                const [currentVerification] = currentEvent
                    ? await tx.select()
                        .from(retentionTriggerVerifications)
                        .where(eq(retentionTriggerVerifications.eventId, currentEvent.id))
                        .limit(1)
                    : [];
                const [latestEvent] = await tx.select({ id: retentionTriggerEvents.id })
                    .from(retentionTriggerEvents)
                    .where(eq(retentionTriggerEvents.arsipId, archive.id))
                    .orderBy(desc(retentionTriggerEvents.revision))
                    .limit(1);
                const snapshotRetention = recordObject(recordObject(ruleSnapshot?.snapshot)?.retention);

                if (!ruleSnapshot || ruleSnapshot.status !== 'verified'
                    || canonicalSha256(ruleSnapshot.snapshot) !== ruleSnapshot.snapshotSha256
                    || !snapshotRetention
                    || canonicalSha256(snapshotRetention) !== archive.retentionDecisionHash
                    || submittedRule?.id !== ruleSnapshot.id
                    || submittedRule?.sha256 !== ruleSnapshot.snapshotSha256
                    || submittedArchive?.id !== archive.id
                    || submittedArchive?.retentionDecisionHash !== archive.retentionDecisionHash
                    || !currentEvent
                    || latestEvent?.id !== currentEvent.id
                    || submittedEvent?.id !== currentEvent.id
                    || currentVerification?.verdict !== 'verified'
                    || !currentVerification.verifierId
                    || currentVerification.verifierId === currentEvent.actorId
                    || submittedVerification?.verdict !== 'verified'
                    || submittedVerification?.verifierId !== currentVerification.verifierId) {
                    throw new ConflictError(
                        'Pengajuan appraisal sudah kedaluwarsa terhadap aturan atau pemicu retensi saat ini. Ajukan appraisal baru.',
                    );
                }
            }

            const componentRows = decisionStatus === 'approved'
                ? await assertItemsBelongToArchive(
                    tx,
                    appraisalCase.arsipId,
                    appraisalCase.proposedItemDecisions.map((item) => item.arsipItemId),
                )
                : [];
            const [latestPriorDecision] = decisionStatus === 'approved'
                ? await tx.select({ id: jraAppraisalDecisions.id })
                    .from(jraAppraisalDecisions)
                    .where(and(
                        eq(jraAppraisalDecisions.arsipId, appraisalCase.arsipId),
                        eq(jraAppraisalDecisions.decisionStatus, 'approved'),
                    ))
                    .orderBy(desc(jraAppraisalDecisions.createdAt), desc(jraAppraisalDecisions.id))
                    .limit(1)
                : [];
            const supersedesDecisionId = decisionStatus === 'approved'
                ? archive.currentAppraisalDecisionId || latestPriorDecision?.id || null
                : null;
            const reviewedAt = new Date();
            const decisionSnapshot = {
                schemaVersion: 1,
                caseId: appraisalCase.id,
                arsipId: appraisalCase.arsipId,
                submissionSha256: appraisalCase.submissionSha256,
                submissionSnapshot: appraisalCase.submissionSnapshot,
                decisionStatus,
                outcome: decisionStatus === 'approved' ? appraisalCase.proposedOutcome : null,
                rationale: reason,
                assessorId: appraisalCase.assessorId,
                reviewerId: actor.id,
                reviewedAt,
            };
            const decisionSha256 = canonicalSha256(decisionSnapshot);
            const [decision] = await tx.insert(jraAppraisalDecisions).values({
                caseId: appraisalCase.id,
                arsipId: appraisalCase.arsipId,
                decisionStatus,
                outcome: decisionStatus === 'approved' ? appraisalCase.proposedOutcome : null,
                rationale: reason,
                decisionSnapshot,
                decisionSha256,
                assessorId: appraisalCase.assessorId,
                reviewerId: actor.id,
                supersedesDecisionId,
                createdAt: reviewedAt,
            }).returning();

            const componentsById = new Map(componentRows.map((row: any) => [row.id, row]));
            const itemDecisions = decisionStatus === 'approved'
                ? await Promise.all(appraisalCase.proposedItemDecisions.map(async (proposal) => {
                    const itemSnapshot = {
                        schemaVersion: 1,
                        decisionId: decision.id,
                        caseId: appraisalCase.id,
                        arsipId: appraisalCase.arsipId,
                        arsipItem: componentsById.get(proposal.arsipItemId),
                        outcome: proposal.outcome,
                        basis: proposal.basis,
                        parentOutcome: appraisalCase.proposedOutcome,
                        submissionSha256: appraisalCase.submissionSha256,
                        decidedAt: reviewedAt,
                    };
                    const [created] = await tx.insert(arsipItemRetentionDecisions).values({
                        decisionId: decision.id,
                        caseId: appraisalCase.id,
                        arsipId: appraisalCase.arsipId,
                        arsipItemId: proposal.arsipItemId,
                        outcome: proposal.outcome,
                        basis: proposal.basis,
                        decisionSnapshot: itemSnapshot,
                        decisionSha256: canonicalSha256(itemSnapshot),
                        createdAt: reviewedAt,
                    }).returning();
                    return created;
                }))
                : [];

            const [updatedCase] = await tx.update(jraAppraisalCases).set({
                status: decisionStatus,
                reviewerId: actor.id,
                reviewedAt,
                reviewReason: reason,
                updatedAt: reviewedAt,
            }).where(and(
                eq(jraAppraisalCases.id, caseId),
                eq(jraAppraisalCases.status, 'in_review'),
            )).returning();
            if (!updatedCase) throw new ConflictError('Status kasus berubah. Muat ulang data.');

            if (decisionStatus === 'approved') {
                const pointerCondition = archive.currentAppraisalDecisionId
                    ? eq(arsip.currentAppraisalDecisionId, archive.currentAppraisalDecisionId)
                    : isNull(arsip.currentAppraisalDecisionId);
                const [published] = await tx.update(arsip).set({
                    currentAppraisalDecisionId: decision.id,
                    updatedAt: reviewedAt,
                }).where(and(
                    eq(arsip.id, archive.id),
                    pointerCondition,
                )).returning({ id: arsip.id });
                if (!published) {
                    throw new ConflictError('Keputusan appraisal berubah bersamaan. Muat ulang data.');
                }
            }

            await audit(
                tx,
                actor,
                decisionStatus === 'approved' ? 'appraisal_approve' : 'appraisal_reject',
                'jra_appraisal',
                caseId,
                {
                    decisionId: decision.id,
                    decisionSha256,
                    outcome: decision.outcome,
                    supersedesDecisionId: decision.supersedesDecisionId,
                    itemDecisionCount: itemDecisions.length,
                    reason,
                },
            );
            return { case: updatedCase, decision, itemDecisions };
        }), 'Kasus appraisal sudah memiliki keputusan final.');
    }

    async createRetentionEvent(
        actor: RetentionGovernanceActor,
        input: CreateRetentionTriggerEventInput,
    ) {
        await assertArchiveAccess(actor, input.arsipId, true);

        return withUniqueConflict(() => db.transaction(async (tx) => {
            const archive = await lockArchive(tx, input.arsipId);
            assertVerifiedRuleContext(archive);
            assertUnitAccess(actor, archive.unitKerjaId);
            if (archive.legalHold || archive.disposalStatus !== 'active' || archive.disposalBatchId) {
                throw new ConflictError(
                    'Peristiwa retensi tidak dapat diubah saat legal hold atau setelah arsip masuk workflow penyusutan.',
                );
            }
            const [activeAppraisal] = await tx.select({ id: jraAppraisalCases.id })
                .from(jraAppraisalCases)
                .where(and(
                    eq(jraAppraisalCases.arsipId, input.arsipId),
                    inArray(jraAppraisalCases.status, ['open', 'in_review']),
                ))
                .limit(1)
                .for('update');
            if (activeAppraisal) {
                throw new ConflictError(
                    'Peristiwa retensi tidak dapat dikoreksi selama appraisal masih aktif.',
                );
            }
            const [latest] = await tx.select()
                .from(retentionTriggerEvents)
                .where(eq(retentionTriggerEvents.arsipId, input.arsipId))
                .orderBy(desc(retentionTriggerEvents.revision))
                .limit(1)
                .for('update');

            if (!input.correctsEventId && latest) {
                throw new ConflictError('Gunakan koreksi untuk menambahkan revisi peristiwa retensi.');
            }
            if (input.correctsEventId && (!latest || latest.id !== input.correctsEventId)) {
                throw new ConflictError('Koreksi wajib merujuk revisi peristiwa yang paling mutakhir.');
            }
            const revision = latest ? latest.revision + 1 : 1;
            const [created] = await tx.insert(retentionTriggerEvents).values({
                arsipId: input.arsipId,
                revision,
                eventType: input.eventType,
                eventDate: input.eventDate,
                label: input.label,
                evidenceUri: input.evidenceUri,
                evidenceSha256: input.evidenceSha256,
                correctsEventId: input.correctsEventId || null,
                correctionReason: input.correctionReason || null,
                actorId: actor.id,
            }).returning();
            await audit(tx, actor, revision === 1 ? 'retention_event_create' : 'retention_event_correct', 'retention_event', created.id, {
                arsipId: created.arsipId,
                revision: created.revision,
                eventType: created.eventType,
                eventDate: created.eventDate,
                evidenceSha256: created.evidenceSha256,
                correctsEventId: created.correctsEventId,
            });
            return created;
        }), 'Revisi peristiwa retensi berubah bersamaan. Muat ulang data.');
    }

    async verifyRetentionEvent(
        actor: RetentionGovernanceActor,
        eventId: string,
        input: { verdict: 'verified' | 'rejected'; note: string },
    ) {
        assertReviewer(actor);
        const [existing] = await db.select()
            .from(retentionTriggerEvents)
            .where(eq(retentionTriggerEvents.id, eventId))
            .limit(1);
        if (!existing) throw new NotFoundError('Peristiwa retensi');
        await assertArchiveAccess(actor, existing.arsipId, true);
        if (existing.actorId === actor.id) {
            throw new ForbiddenError('Pencatat peristiwa tidak boleh memverifikasi buktinya sendiri.');
        }

        return withUniqueConflict(() => db.transaction(async (tx) => {
            // Lock order is archive -> event throughout governance workflows.
            // This also makes the pointer/cache publication atomic with the
            // independent verification row.
            const archive = await lockArchive(tx, existing.arsipId);
            assertVerifiedRuleContext(archive);
            assertUnitAccess(actor, archive.unitKerjaId);
            if (archive.legalHold || archive.disposalStatus !== 'active' || archive.disposalBatchId) {
                throw new ConflictError(
                    'Verifikasi pemicu ditolak saat legal hold atau setelah arsip masuk workflow penyusutan.',
                );
            }

            const [event] = await tx.select()
                .from(retentionTriggerEvents)
                .where(and(
                    eq(retentionTriggerEvents.id, eventId),
                    eq(retentionTriggerEvents.arsipId, archive.id),
                ))
                .limit(1)
                .for('update');
            if (!event) throw new NotFoundError('Peristiwa retensi');
            if (event.actorId === actor.id) {
                throw new ForbiddenError('Pencatat peristiwa tidak boleh memverifikasi buktinya sendiri.');
            }
            const [latest] = await tx.select({ id: retentionTriggerEvents.id })
                .from(retentionTriggerEvents)
                .where(eq(retentionTriggerEvents.arsipId, event.arsipId))
                .orderBy(desc(retentionTriggerEvents.revision))
                .limit(1);
            if (latest?.id !== event.id) {
                throw new ConflictError('Hanya revisi peristiwa terbaru yang dapat diverifikasi.');
            }
            const [verification] = await tx.insert(retentionTriggerVerifications).values({
                eventId,
                verdict: input.verdict,
                note: input.note,
                verifierId: actor.id,
            }).returning();
            if (verification.verdict === 'verified') {
                const [ruleSnapshot] = await tx.select()
                    .from(arsipRuleSnapshots)
                    .where(and(
                        eq(arsipRuleSnapshots.id, archive.currentRuleSnapshotId!),
                        eq(arsipRuleSnapshots.arsipId, archive.id),
                    ))
                    .limit(1);
                if (!ruleSnapshot) {
                    throw new ConflictError('Snapshot aturan arsip saat ini tidak ditemukan.');
                }
                const evaluation = archiveRuleAssignmentService.evaluateCanonicalRetention(
                    event.eventDate,
                    {
                        arsipId: archive.id,
                        ruleProvenanceStatus: archive.ruleProvenanceStatus,
                        currentRuleSnapshotId: archive.currentRuleSnapshotId,
                        jraItemId: archive.jraItemId,
                        jraRuleSetId: archive.jraRuleSetId,
                        retentionDecisionHash: archive.retentionDecisionHash,
                        snapshotId: ruleSnapshot.id,
                        snapshotArsipId: ruleSnapshot.arsipId,
                        snapshotStatus: ruleSnapshot.status,
                        snapshotJraItemId: ruleSnapshot.jraItemId,
                        snapshotJraRuleSetId: ruleSnapshot.jraRuleSetId,
                        snapshot: ruleSnapshot.snapshot,
                        snapshotSha256: ruleSnapshot.snapshotSha256,
                        currentRetentionTriggerEventId: event.id,
                        triggerEventRecordId: event.id,
                        triggerEventArsipId: event.arsipId,
                        triggerEventDate: event.eventDate,
                        triggerEventRevision: event.revision,
                        triggerEventActorId: event.actorId,
                        triggerVerificationVerdict: verification.verdict,
                        triggerVerifierId: verification.verifierId,
                        latestTriggerEventRevision: event.revision,
                        currentAppraisalDecisionId: null,
                        hasActiveAppraisalCase: false,
                    },
                );
                if (!evaluation.verified) {
                    throw new ConflictError(
                        `Pemicu tidak dapat diterbitkan: ${evaluation.blockReason}.`,
                    );
                }
                const [published] = await tx.update(arsip).set({
                    currentRetentionTriggerEventId: event.id,
                    retentionTriggerType: event.eventType,
                    retentionTriggerLabel: event.label,
                    retentionTriggerDate: event.eventDate,
                    retentionTriggerEvidence: event.evidenceUri,
                    tanggalKadaluarsa: evaluation.dates.tanggalKadaluarsa,
                    currentAppraisalDecisionId: null,
                    updatedAt: new Date(),
                }).where(and(
                    eq(arsip.id, archive.id),
                    isNull(arsip.currentRetentionTriggerEventId),
                )).returning({ id: arsip.id });
                if (!published) {
                    throw new ConflictError('Pemicu retensi berubah bersamaan. Muat ulang data.');
                }
            }
            await audit(tx, actor, 'retention_event_verify', 'retention_event', eventId, {
                verdict: verification.verdict,
                note: verification.note,
                evidenceSha256: event.evidenceSha256,
            });
            return verification;
        }), 'Peristiwa retensi sudah diverifikasi.');
    }

    async listRetentionVerificationQueue(
        actor: RetentionGovernanceActor,
        filters: {
            verificationStatus: 'pending' | 'verified' | 'rejected';
            page: number;
            limit: number;
        },
    ) {
        const conditions = [
            // A superseded revision is preserved as evidence but must not remain
            // in the operational verification queue.
            sql`NOT EXISTS (
                SELECT 1 FROM retention_trigger_events newer_event
                WHERE newer_event.arsip_id = ${retentionTriggerEvents.arsipId}
                  AND newer_event.revision > ${retentionTriggerEvents.revision}
            )`,
        ];
        const scope = unitCondition(actor);
        if (scope) conditions.push(scope);
        conditions.push(purposeBoundListAccessCondition(actor));
        if (filters.verificationStatus === 'pending') {
            conditions.push(isNull(retentionTriggerVerifications.id));
        } else {
            conditions.push(eq(
                retentionTriggerVerifications.verdict,
                filters.verificationStatus,
            ));
        }
        const where = and(...conditions);
        const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
            .from(retentionTriggerEvents)
            .innerJoin(arsip, eq(retentionTriggerEvents.arsipId, arsip.id))
            .leftJoin(
                retentionTriggerVerifications,
                eq(retentionTriggerEvents.id, retentionTriggerVerifications.eventId),
            )
            .where(where);
        const data = await db.select({
            id: retentionTriggerEvents.id,
            arsipId: retentionTriggerEvents.arsipId,
            revision: retentionTriggerEvents.revision,
            eventType: retentionTriggerEvents.eventType,
            eventDate: retentionTriggerEvents.eventDate,
            label: retentionTriggerEvents.label,
            evidenceUri: retentionTriggerEvents.evidenceUri,
            evidenceSha256: retentionTriggerEvents.evidenceSha256,
            correctsEventId: retentionTriggerEvents.correctsEventId,
            correctionReason: retentionTriggerEvents.correctionReason,
            actorId: retentionTriggerEvents.actorId,
            createdAt: retentionTriggerEvents.createdAt,
            verificationId: retentionTriggerVerifications.id,
            verdict: retentionTriggerVerifications.verdict,
            verifierId: retentionTriggerVerifications.verifierId,
            verifiedAt: retentionTriggerVerifications.verifiedAt,
            unitKerjaId: arsip.unitKerjaId,
            nomorBerkas: arsip.nomorBerkas,
            uraianBerkas: arsip.uraianBerkas,
            jraKode: arsip.jraKode,
        })
            .from(retentionTriggerEvents)
            .innerJoin(arsip, eq(retentionTriggerEvents.arsipId, arsip.id))
            .leftJoin(
                retentionTriggerVerifications,
                eq(retentionTriggerEvents.id, retentionTriggerVerifications.eventId),
            )
            .where(where)
            .orderBy(asc(retentionTriggerEvents.createdAt))
            .limit(filters.limit)
            .offset((filters.page - 1) * filters.limit);
        return {
            data,
            pagination: {
                page: filters.page,
                limit: filters.limit,
                total: count,
                totalPages: Math.ceil(count / filters.limit),
            },
        };
    }

    async listRetentionEvents(actor: RetentionGovernanceActor, arsipId: string) {
        await assertArchiveAccess(actor, arsipId, false);
        const [[archivePointer], rows] = await Promise.all([
            db.select({ id: arsip.id, eventId: arsip.currentRetentionTriggerEventId })
                .from(arsip)
                .where(eq(arsip.id, arsipId))
                .limit(1),
            db.select({
                event: retentionTriggerEvents,
                verification: retentionTriggerVerifications,
            })
                .from(retentionTriggerEvents)
                .leftJoin(
                    retentionTriggerVerifications,
                    eq(retentionTriggerEvents.id, retentionTriggerVerifications.eventId),
                )
                .where(eq(retentionTriggerEvents.arsipId, arsipId))
                .orderBy(desc(retentionTriggerEvents.revision)),
        ]);
        const latest = rows[0] || null;
        return {
            data: rows,
            currentVerified: latest?.event.id === archivePointer?.eventId
                && latest?.verification?.verdict === 'verified'
                ? latest
                : null,
        };
    }

    async createPermanentTransferManifest(
        actor: RetentionGovernanceActor,
        input: CreatePermanentTransferManifestInput,
    ) {
        assertReviewer(actor);
        for (const item of input.items) {
            await assertArchiveAccess(actor, item.arsipId, true);
        }

        return withUniqueConflict(() => db.transaction(async (tx) => {
            const archiveRows = [];
            for (const archiveId of [...new Set(input.items.map((item) => item.arsipId))].sort()) {
                archiveRows.push(await lockArchive(tx, archiveId));
            }
            const blockedArchive = archiveRows.find((row) =>
                row.legalHold || row.disposalStatus !== 'active' || row.disposalBatchId,
            );
            if (blockedArchive) {
                throw new ConflictError(
                    `Arsip ${blockedArchive.id} sedang legal hold atau telah direservasi workflow penyusutan lain.`,
                );
            }
            const unitKerjaId = archiveRows[0]?.unitKerjaId;
            if (!unitKerjaId || archiveRows.some((row) => row.unitKerjaId !== unitKerjaId)) {
                throw new ValidationError('Satu manifest hanya boleh memuat arsip dari unit kerja yang sama.');
            }
            assertUnitAccess(actor, unitKerjaId);

            if (input.supersedesManifestId) {
                const [predecessor] = await tx.select()
                    .from(permanentTransferManifests)
                    .where(eq(permanentTransferManifests.id, input.supersedesManifestId))
                    .limit(1)
                    .for('update');
                if (!predecessor || predecessor.unitKerjaId !== unitKerjaId) {
                    throw new ValidationError('Manifest yang digantikan tidak ditemukan pada unit kerja yang sama.');
                }
                const [approvedCancellation] = await tx.select({
                    id: permanentTransferCancellationRequests.id,
                })
                    .from(permanentTransferCancellationRequests)
                    .where(and(
                        eq(permanentTransferCancellationRequests.manifestId, predecessor.id),
                        eq(permanentTransferCancellationRequests.status, 'approved'),
                    ))
                    .limit(1)
                    .for('update');
                if (!approvedCancellation) {
                    throw new ConflictError(
                        'Manifest pengganti hanya dapat dibuat setelah pembatalan manifest sebelumnya disetujui.',
                    );
                }
                const [predecessorEvent] = await tx.select({ id: permanentTransferEvents.id })
                    .from(permanentTransferEvents)
                    .where(eq(permanentTransferEvents.manifestId, predecessor.id))
                    .limit(1)
                    .for('update');
                if (predecessorEvent) {
                    throw new ConflictError(
                        'Manifest yang telah diserahterimakan tidak dapat digantikan.',
                    );
                }
            }

            const archivesById = new Map(archiveRows.map((row) => [row.id, row]));
            const evidenceByArchive = new Map<string, any>();
            for (const item of input.items) {
                const archive = archivesById.get(item.arsipId)!;
                await assertCurrentPermanentArchiveContext(tx, archive, item.appraisalDecisionId);
                const attachment = await assertReleasedTransferAttachment(
                    tx,
                    item.objectUri,
                    item.objectSha256,
                    [archive.id],
                );
                evidenceByArchive.set(archive.id, attachment);
            }

            const [manifest] = await tx.insert(permanentTransferManifests).values({
                unitKerjaId,
                manifestNumber: input.manifestNumber,
                destination: input.destination,
                description: input.description || null,
                supersedesManifestId: input.supersedesManifestId || null,
                createdBy: actor.id,
            }).returning();
            const reserved = await tx.update(arsip).set({
                disposalStatus: 'proposed_serah',
                disposalBatchId: manifest.id,
                updatedAt: new Date(),
            }).where(and(
                inArray(arsip.id, archiveRows.map((row) => row.id)),
                eq(arsip.disposalStatus, 'active'),
                isNull(arsip.disposalBatchId),
                eq(arsip.legalHold, false),
            )).returning({ id: arsip.id });
            if (reserved.length !== archiveRows.length) {
                throw new ConflictError('Reservasi arsip berubah bersamaan. Muat ulang manifest.');
            }
            const verifiedAt = new Date();
            const items = await tx.insert(permanentTransferManifestItems).values(
                input.items.map((item) => ({
                    manifestId: manifest.id,
                    arsipId: item.arsipId,
                    appraisalDecisionId: item.appraisalDecisionId,
                    objectUri: item.objectUri,
                    objectSha256: item.objectSha256,
                    evidenceAttachmentId: evidenceByArchive.get(item.arsipId).id,
                    evidenceVerifiedAt: verifiedAt,
                })),
            ).returning();
            await audit(tx, actor, 'transfer_manifest_create', 'permanent_transfer', manifest.id, {
                manifestNumber: manifest.manifestNumber,
                destination: manifest.destination,
                supersedesManifestId: manifest.supersedesManifestId,
                archiveCount: items.length,
                itemChecksums: items.map((item: any) => ({
                    arsipId: item.arsipId,
                    sha256: item.objectSha256,
                    evidenceAttachmentId: item.evidenceAttachmentId,
                    evidenceVerifiedAt: item.evidenceVerifiedAt,
                })),
            });
            return {
                ...manifest,
                status: 'draft' as const,
                items,
                events: [],
                cancellations: [],
            };
        }), 'Nomor manifest atau reservasi arsip dalam manifest penyerahan sudah digunakan.');
    }

    async listPermanentTransfers(
        actor: RetentionGovernanceActor,
        filters: {
            status?: PermanentTransferStatus;
            page: number;
            limit: number;
        },
    ) {
        const conditions = [];
        const scope = manifestUnitCondition(actor);
        if (scope) conditions.push(scope);
        conditions.push(sql`NOT EXISTS (
            SELECT 1
            FROM permanent_transfer_manifest_items scoped_item
            INNER JOIN arsip scoped_archive ON scoped_archive.id = scoped_item.arsip_id
            WHERE scoped_item.manifest_id = ${permanentTransferManifests.id}
              AND NOT (
                lower(coalesce(scoped_archive.klasifikasi_keamanan, 'biasa')) = 'biasa'
                OR EXISTS (
                    SELECT 1 FROM record_access_grants access_grant
                    WHERE access_grant.target_user_id = ${actor.id}
                      AND access_grant.entity_type = 'arsip'
                      AND access_grant.entity_id = scoped_archive.id
                      AND access_grant.unit_kerja_id = scoped_archive.unit_kerja_id
                      AND access_grant.required_classification = lower(scoped_archive.klasifikasi_keamanan)
                      AND access_grant.status = 'approved'
                      AND access_grant.expires_at > now()
                )
              )
        )`);
        if (filters.status) {
            conditions.push(sql`${permanentTransferStatusSql()} = ${filters.status}`);
        }
        const where = and(...conditions);
        const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
            .from(permanentTransferManifests)
            .where(where);
        const data = await db.select({
            id: permanentTransferManifests.id,
            unitKerjaId: permanentTransferManifests.unitKerjaId,
            manifestNumber: permanentTransferManifests.manifestNumber,
            destination: permanentTransferManifests.destination,
            description: permanentTransferManifests.description,
            supersedesManifestId: permanentTransferManifests.supersedesManifestId,
            createdBy: permanentTransferManifests.createdBy,
            createdAt: permanentTransferManifests.createdAt,
            status: permanentTransferStatusSql(),
            archiveCount: sql<number>`(
                SELECT count(*)::int FROM permanent_transfer_manifest_items item_count
                WHERE item_count.manifest_id = ${permanentTransferManifests.id}
            )`,
        })
            .from(permanentTransferManifests)
            .where(where)
            .orderBy(desc(permanentTransferManifests.createdAt))
            .limit(filters.limit)
            .offset((filters.page - 1) * filters.limit);
        return {
            data,
            pagination: {
                page: filters.page,
                limit: filters.limit,
                total: count,
                totalPages: Math.ceil(count / filters.limit),
            },
        };
    }

    async getPermanentTransfer(actor: RetentionGovernanceActor, manifestId: string) {
        const manifest = await getManifestForActor(actor, manifestId);
        const [items, events, cancellations] = await Promise.all([
            db.select()
                .from(permanentTransferManifestItems)
                .where(eq(permanentTransferManifestItems.manifestId, manifestId))
                .orderBy(asc(permanentTransferManifestItems.createdAt)),
            db.select()
                .from(permanentTransferEvents)
                .where(eq(permanentTransferEvents.manifestId, manifestId))
                .orderBy(asc(permanentTransferEvents.eventAt)),
            db.select()
                .from(permanentTransferCancellationRequests)
                .where(eq(permanentTransferCancellationRequests.manifestId, manifestId))
                .orderBy(asc(permanentTransferCancellationRequests.requestedAt)),
        ]);
        for (const item of items) await assertArchiveAccess(actor, item.arsipId, false);
        return {
            ...manifest,
            status: derivePermanentTransferStatus(
                events.map((event) => event.eventType),
                cancellations.map((request) => request.status),
            ),
            items,
            events,
            cancellations,
        };
    }

    async recordPermanentTransferEvent(
        actor: RetentionGovernanceActor,
        manifestId: string,
        eventType: TransferEventType,
        input: PermanentTransferEventInput,
    ) {
        assertReviewer(actor);
        const existing = await getManifestForActor(actor, manifestId);
        assertUnitAccess(actor, existing.unitKerjaId);
        const scopedItems = await db.select({ arsipId: permanentTransferManifestItems.arsipId })
            .from(permanentTransferManifestItems)
            .where(eq(permanentTransferManifestItems.manifestId, manifestId));
        if (scopedItems.length === 0) {
            throw new ConflictError('Manifest tidak memiliki arsip untuk diserahterimakan.');
        }
        for (const item of scopedItems) {
            await assertArchiveAccess(actor, item.arsipId, true);
        }

        return withUniqueConflict(() => db.transaction(async (tx) => {
            const [manifest] = await tx.select()
                .from(permanentTransferManifests)
                .where(eq(permanentTransferManifests.id, manifestId))
                .limit(1)
                .for('update');
            if (!manifest) throw new NotFoundError('Manifest penyerahan');
            assertUnitAccess(actor, manifest.unitKerjaId);

            const events = await tx.select()
                .from(permanentTransferEvents)
                .where(eq(permanentTransferEvents.manifestId, manifestId))
                .orderBy(asc(permanentTransferEvents.eventAt))
                .for('update');
            const cancellations = await tx.select()
                .from(permanentTransferCancellationRequests)
                .where(eq(permanentTransferCancellationRequests.manifestId, manifestId))
                .orderBy(asc(permanentTransferCancellationRequests.requestedAt))
                .for('update');
            if (cancellations.some((request: any) => ['pending', 'approved'].includes(request.status))) {
                throw new ConflictError('Permintaan pembatalan yang masih aktif memblokir serah terima.');
            }
            const handover = events.find((event: any) => event.eventType === 'handover');
            const acknowledgement = events.find((event: any) => event.eventType === 'acknowledgement');
            if (eventType === 'handover' && (handover || acknowledgement)) {
                throw new ConflictError('Manifest sudah diserahterimakan.');
            }
            if (eventType === 'acknowledgement') {
                if (!handover) throw new ConflictError('Catat serah terima sebelum bukti penerimaan.');
                if (acknowledgement) throw new ConflictError('Bukti penerimaan sudah tercatat.');
                if (new Date(input.eventAt).getTime() < new Date(handover.eventAt).getTime()) {
                    throw new ValidationError('Waktu penerimaan tidak boleh mendahului serah terima.');
                }
                if (handover.actorId === actor.id) {
                    throw new ForbiddenError(
                        'Pejabat pencatat serah terima tidak boleh mengakui penerimaannya sendiri.',
                    );
                }
            }

            const { items } = await lockAndAssertManifestItems(tx, manifestId);
            const documentAttachment = await assertReleasedTransferAttachment(
                tx,
                input.documentUri,
                input.documentSha256,
                items.map((item: any) => item.arsipId),
            );
            const evidenceVerifiedAt = new Date();

            const [created] = await tx.insert(permanentTransferEvents).values({
                manifestId,
                eventType,
                eventAt: new Date(input.eventAt),
                referenceNumber: input.referenceNumber,
                counterparty: input.counterparty,
                documentUri: input.documentUri,
                documentSha256: input.documentSha256,
                evidenceAttachmentId: documentAttachment.id,
                evidenceVerifiedAt,
                notes: input.notes || null,
                actorId: actor.id,
            }).returning();
            await audit(tx, actor, eventType === 'handover' ? 'transfer_handover' : 'transfer_acknowledge', 'permanent_transfer', manifestId, {
                eventId: created.id,
                eventType: created.eventType,
                eventAt: created.eventAt,
                referenceNumber: created.referenceNumber,
                counterparty: created.counterparty,
                documentSha256: created.documentSha256,
                evidenceAttachmentId: created.evidenceAttachmentId,
                evidenceVerifiedAt: created.evidenceVerifiedAt,
                separationOfDuties: eventType === 'acknowledgement'
                    ? { handoverActorId: handover?.actorId, acknowledgementActorId: actor.id }
                    : null,
            });
            return created;
        }), eventType === 'handover'
            ? 'Manifest sudah memiliki bukti serah terima.'
            : 'Manifest sudah memiliki bukti penerimaan.');
    }

    async requestPermanentTransferCancellation(
        actor: RetentionGovernanceActor,
        manifestId: string,
        input: RequestPermanentTransferCancellationInput,
    ) {
        assertReviewer(actor);
        const existing = await getManifestForActor(actor, manifestId);
        assertUnitAccess(actor, existing.unitKerjaId);
        const scopedItems = await db.select({ arsipId: permanentTransferManifestItems.arsipId })
            .from(permanentTransferManifestItems)
            .where(eq(permanentTransferManifestItems.manifestId, manifestId));
        if (scopedItems.length === 0) throw new ConflictError('Manifest tidak memiliki arsip.');
        for (const item of scopedItems) await assertArchiveAccess(actor, item.arsipId, true);

        return withUniqueConflict(() => db.transaction(async (tx) => {
            const [manifest] = await tx.select()
                .from(permanentTransferManifests)
                .where(eq(permanentTransferManifests.id, manifestId))
                .limit(1)
                .for('update');
            if (!manifest) throw new NotFoundError('Manifest penyerahan');
            assertUnitAccess(actor, manifest.unitKerjaId);
            const events = await tx.select({ id: permanentTransferEvents.id })
                .from(permanentTransferEvents)
                .where(eq(permanentTransferEvents.manifestId, manifestId))
                .limit(1)
                .for('update');
            if (events.length > 0) {
                throw new ConflictError('Manifest yang telah diserahterimakan tidak dapat dibatalkan.');
            }
            const requests = await tx.select()
                .from(permanentTransferCancellationRequests)
                .where(eq(permanentTransferCancellationRequests.manifestId, manifestId))
                .for('update');
            if (requests.some((request: any) => request.status === 'approved')) {
                throw new ConflictError('Manifest sudah dibatalkan.');
            }
            if (requests.some((request: any) => request.status === 'pending')) {
                throw new ConflictError('Permintaan pembatalan masih menunggu penelaahan.');
            }
            const items = await tx.select()
                .from(permanentTransferManifestItems)
                .where(eq(permanentTransferManifestItems.manifestId, manifestId))
                .orderBy(asc(permanentTransferManifestItems.arsipId))
                .for('update');
            for (const archiveId of items.map((item: any) => item.arsipId).sort()) {
                const archive = await lockArchive(tx, archiveId);
                if (
                    archive.disposalStatus !== 'proposed_serah'
                    || archive.disposalBatchId !== manifestId
                ) {
                    throw new ConflictError(`Reservasi arsip ${archive.id} tidak lagi dimiliki manifest.`);
                }
            }
            const [created] = await tx.insert(permanentTransferCancellationRequests).values({
                manifestId,
                reason: input.reason,
                requestedBy: actor.id,
            }).returning();
            await audit(tx, actor, 'transfer_cancellation_request', 'permanent_transfer', manifestId, {
                cancellationRequestId: created.id,
                reason: created.reason,
                requestedBy: created.requestedBy,
            });
            return created;
        }), 'Permintaan pembatalan aktif sudah ada untuk manifest ini.');
    }

    async reviewPermanentTransferCancellation(
        actor: RetentionGovernanceActor,
        manifestId: string,
        requestId: string,
        input: ReviewPermanentTransferCancellationInput,
    ) {
        assertReviewer(actor);
        const existing = await getManifestForActor(actor, manifestId);
        assertUnitAccess(actor, existing.unitKerjaId);
        const scopedItems = await db.select({ arsipId: permanentTransferManifestItems.arsipId })
            .from(permanentTransferManifestItems)
            .where(eq(permanentTransferManifestItems.manifestId, manifestId));
        for (const item of scopedItems) await assertArchiveAccess(actor, item.arsipId, true);

        return withUniqueConflict(() => db.transaction(async (tx) => {
            const [manifest] = await tx.select()
                .from(permanentTransferManifests)
                .where(eq(permanentTransferManifests.id, manifestId))
                .limit(1)
                .for('update');
            if (!manifest) throw new NotFoundError('Manifest penyerahan');
            assertUnitAccess(actor, manifest.unitKerjaId);
            const [request] = await tx.select()
                .from(permanentTransferCancellationRequests)
                .where(and(
                    eq(permanentTransferCancellationRequests.id, requestId),
                    eq(permanentTransferCancellationRequests.manifestId, manifestId),
                ))
                .limit(1)
                .for('update');
            if (!request) throw new NotFoundError('Permintaan pembatalan manifest');
            if (request.status !== 'pending') {
                throw new ConflictError('Permintaan pembatalan sudah ditelaah.');
            }
            if (request.requestedBy === actor.id) {
                throw new ForbiddenError(
                    'Pemohon pembatalan tidak boleh menelaah permohonannya sendiri.',
                );
            }
            const events = await tx.select({ id: permanentTransferEvents.id })
                .from(permanentTransferEvents)
                .where(eq(permanentTransferEvents.manifestId, manifestId))
                .limit(1)
                .for('update');
            if (events.length > 0) {
                throw new ConflictError('Manifest telah diserahterimakan dan tidak dapat dibatalkan.');
            }
            const items = await tx.select()
                .from(permanentTransferManifestItems)
                .where(eq(permanentTransferManifestItems.manifestId, manifestId))
                .orderBy(asc(permanentTransferManifestItems.arsipId))
                .for('update');
            if (items.length === 0) throw new ConflictError('Manifest tidak memiliki arsip.');
            for (const archiveId of items.map((item: any) => item.arsipId).sort()) {
                const archive = await lockArchive(tx, archiveId);
                if (
                    archive.disposalStatus !== 'proposed_serah'
                    || archive.disposalBatchId !== manifestId
                ) {
                    throw new ConflictError(`Reservasi arsip ${archive.id} berubah sebelum penelaahan.`);
                }
            }
            const reviewedAt = new Date();
            const [updated] = await tx.update(permanentTransferCancellationRequests).set({
                status: input.verdict,
                reviewedBy: actor.id,
                reviewedAt,
                reviewNote: input.note,
            }).where(and(
                eq(permanentTransferCancellationRequests.id, requestId),
                eq(permanentTransferCancellationRequests.status, 'pending'),
            )).returning();
            if (!updated) throw new ConflictError('Status permintaan pembatalan berubah bersamaan.');
            await audit(tx, actor, 'transfer_cancellation_review', 'permanent_transfer', manifestId, {
                cancellationRequestId: requestId,
                verdict: input.verdict,
                note: input.note,
                requestedBy: request.requestedBy,
                reviewedBy: actor.id,
                reservationsReleased: input.verdict === 'approved',
            });
            return updated;
        }), 'Keputusan pembatalan manifest sudah tercatat.');
    }
}

export const retentionGovernanceService = new RetentionGovernanceService();
export default retentionGovernanceService;
