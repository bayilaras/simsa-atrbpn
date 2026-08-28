import { relations, sql } from 'drizzle-orm';
import {
    check,
    date,
    foreignKey,
    index,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    varchar,
    type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { arsip } from './arsip';
import { arsipItems } from './arsip-items';
import { fileAttachments } from './file-attachments';
import { unitKerja } from './unit-kerja';
import { users } from './users';

export type AppraisalCaseStatus = 'open' | 'in_review' | 'approved' | 'rejected';
export type RetentionOutcome = 'musnah' | 'permanen' | 'dinilai_kembali';
export type PermanentTransferCancellationStatus = 'pending' | 'approved' | 'rejected';

/**
 * Human appraisal case for conditional/manual JRA rows.
 *
 * The proposal is frozen into submissionSnapshot when the assessor submits it.
 * A final immutable decision is stored separately, so a rejected case cannot be
 * silently edited into an approved one.
 */
export const jraAppraisalCases = pgTable('jra_appraisal_cases', {
    id: uuid('id').primaryKey().defaultRandom(),
    arsipId: uuid('arsip_id').notNull()
        .references(() => arsip.id, { onDelete: 'restrict' }),
    caseType: varchar('case_type', { length: 30 }).notNull(),
    status: varchar('status', { length: 20 })
        .$type<AppraisalCaseStatus>()
        .default('open')
        .notNull(),
    reason: text('reason').notNull(),
    proposedOutcome: varchar('proposed_outcome', { length: 30 })
        .$type<RetentionOutcome>()
        .notNull(),
    proposedRationale: text('proposed_rationale').notNull(),
    proposedItemDecisions: jsonb('proposed_item_decisions')
        .$type<Array<{
            arsipItemId: string;
            outcome: RetentionOutcome;
            basis: string;
        }>>()
        .default([])
        .notNull(),
    submissionSnapshot: jsonb('submission_snapshot').$type<Record<string, unknown>>(),
    submissionSha256: varchar('submission_sha256', { length: 64 }),
    assessorId: uuid('assessor_id').notNull()
        .references(() => users.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewerId: uuid('reviewer_id')
        .references(() => users.id, { onDelete: 'restrict' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewReason: text('review_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('jra_appraisal_cases_arsip_status_idx').on(table.arsipId, table.status),
    uniqueIndex('jra_appraisal_cases_one_active_per_archive_unique')
        .on(table.arsipId)
        .where(sql`${table.status} in ('open', 'in_review')`),
    check(
        'jra_appraisal_cases_type_check',
        sql`${table.caseType} in ('jra_manual', 'dinilai_kembali', 'conditional_exception')`,
    ),
    check(
        'jra_appraisal_cases_status_check',
        sql`${table.status} in ('open', 'in_review', 'approved', 'rejected')`,
    ),
    check(
        'jra_appraisal_cases_outcome_check',
        sql`${table.proposedOutcome} in ('musnah', 'permanen', 'dinilai_kembali')`,
    ),
    check('jra_appraisal_cases_reason_check', sql`length(trim(${table.reason})) >= 20`),
    check(
        'jra_appraisal_cases_rationale_check',
        sql`length(trim(${table.proposedRationale})) >= 20`,
    ),
    check(
        'jra_appraisal_cases_submission_check',
        sql`${table.status} = 'open' or (
            ${table.submittedAt} is not null
            and ${table.submissionSnapshot} is not null
            and ${table.submissionSha256} ~ '^[0-9a-f]{64}$'
        )`,
    ),
    check(
        'jra_appraisal_cases_review_check',
        sql`${table.status} not in ('approved', 'rejected') or (
            ${table.reviewerId} is not null
            and ${table.reviewedAt} is not null
            and length(trim(${table.reviewReason})) >= 10
        )`,
    ),
    check(
        'jra_appraisal_cases_separation_check',
        sql`${table.reviewerId} is null or ${table.reviewerId} <> ${table.assessorId}`,
    ),
]);

/** Evidence is append-only. Corrections are uploaded as new evidence rows. */
export const jraAppraisalEvidence = pgTable('jra_appraisal_evidence', {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id').notNull()
        .references(() => jraAppraisalCases.id, { onDelete: 'restrict' }),
    label: varchar('label', { length: 255 }).notNull(),
    evidenceUri: text('evidence_uri').notNull(),
    evidenceSha256: varchar('evidence_sha256', { length: 64 }).notNull(),
    mediaType: varchar('media_type', { length: 100 }),
    createdBy: uuid('created_by').notNull()
        .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('jra_appraisal_evidence_case_idx').on(table.caseId, table.createdAt),
    check(
        'jra_appraisal_evidence_sha256_check',
        sql`${table.evidenceSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
        'jra_appraisal_evidence_uri_check',
        sql`length(trim(${table.evidenceUri})) >= 5`,
    ),
]);

/** Final approval/rejection record and its exact immutable snapshot. */
export const jraAppraisalDecisions = pgTable('jra_appraisal_decisions', {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id').notNull()
        .references(() => jraAppraisalCases.id, { onDelete: 'restrict' }),
    arsipId: uuid('arsip_id').notNull()
        .references(() => arsip.id, { onDelete: 'restrict' }),
    decisionStatus: varchar('decision_status', { length: 20 }).notNull(),
    outcome: varchar('outcome', { length: 30 }).$type<RetentionOutcome>(),
    rationale: text('rationale').notNull(),
    decisionSnapshot: jsonb('decision_snapshot').$type<Record<string, unknown>>().notNull(),
    decisionSha256: varchar('decision_sha256', { length: 64 }).notNull(),
    supersedesDecisionId: uuid('supersedes_decision_id')
        .references((): AnyPgColumn => jraAppraisalDecisions.id, { onDelete: 'restrict' }),
    assessorId: uuid('assessor_id').notNull()
        .references(() => users.id, { onDelete: 'restrict' }),
    reviewerId: uuid('reviewer_id').notNull()
        .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    uniqueIndex('jra_appraisal_decisions_case_unique').on(table.caseId),
    uniqueIndex('jra_appraisal_decisions_identity_unique')
        .on(table.id, table.caseId, table.arsipId),
    uniqueIndex('jra_appraisal_decisions_identity_archive_unique')
        .on(table.id, table.arsipId),
    uniqueIndex('jra_appraisal_decisions_supersedes_unique')
        .on(table.supersedesDecisionId)
        .where(sql`${table.supersedesDecisionId} is not null`),
    index('jra_appraisal_decisions_arsip_idx').on(table.arsipId, table.createdAt),
    check(
        'jra_appraisal_decisions_status_check',
        sql`${table.decisionStatus} in ('approved', 'rejected')`,
    ),
    check(
        'jra_appraisal_decisions_outcome_check',
        sql`(
            ${table.decisionStatus} = 'approved'
            and ${table.outcome} in ('musnah', 'permanen', 'dinilai_kembali')
        ) or (${table.decisionStatus} = 'rejected' and ${table.outcome} is null)`,
    ),
    check('jra_appraisal_decisions_rationale_check', sql`length(trim(${table.rationale})) >= 10`),
    check(
        'jra_appraisal_decisions_sha256_check',
        sql`${table.decisionSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
        'jra_appraisal_decisions_separation_check',
        sql`${table.assessorId} <> ${table.reviewerId}`,
    ),
]);

/**
 * Immutable child-document result. This models clauses such as “Musnah,
 * kecuali keputusan/berita acara Permanen” without destroying the whole file.
 */
export const arsipItemRetentionDecisions = pgTable('arsip_item_retention_decisions', {
    id: uuid('id').primaryKey().defaultRandom(),
    decisionId: uuid('decision_id').notNull(),
    caseId: uuid('case_id').notNull(),
    arsipId: uuid('arsip_id').notNull(),
    arsipItemId: uuid('arsip_item_id').notNull(),
    outcome: varchar('outcome', { length: 30 }).$type<RetentionOutcome>().notNull(),
    basis: text('basis').notNull(),
    decisionSnapshot: jsonb('decision_snapshot').$type<Record<string, unknown>>().notNull(),
    decisionSha256: varchar('decision_sha256', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    uniqueIndex('arsip_item_retention_decisions_decision_item_unique')
        .on(table.decisionId, table.arsipItemId),
    index('arsip_item_retention_decisions_item_idx').on(table.arsipItemId, table.createdAt),
    check(
        'arsip_item_retention_decisions_outcome_check',
        sql`${table.outcome} in ('musnah', 'permanen', 'dinilai_kembali')`,
    ),
    check('arsip_item_retention_decisions_basis_check', sql`length(trim(${table.basis})) >= 10`),
    check(
        'arsip_item_retention_decisions_sha256_check',
        sql`${table.decisionSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    foreignKey({
        name: 'arsip_item_retention_decisions_parent_fk',
        columns: [table.decisionId, table.caseId, table.arsipId],
        foreignColumns: [jraAppraisalDecisions.id, jraAppraisalDecisions.caseId, jraAppraisalDecisions.arsipId],
    }).onDelete('restrict'),
    foreignKey({
        name: 'arsip_item_retention_decisions_item_archive_fk',
        columns: [table.arsipItemId, table.arsipId],
        foreignColumns: [arsipItems.id, arsipItems.arsipId],
    }).onDelete('restrict'),
]);

/** Append-only business event that starts a retention period. */
export const retentionTriggerEvents = pgTable('retention_trigger_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    arsipId: uuid('arsip_id').notNull()
        .references(() => arsip.id, { onDelete: 'restrict' }),
    revision: integer('revision').notNull(),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    eventDate: date('event_date').notNull(),
    label: varchar('label', { length: 255 }).notNull(),
    evidenceUri: text('evidence_uri').notNull(),
    evidenceSha256: varchar('evidence_sha256', { length: 64 }).notNull(),
    correctsEventId: uuid('corrects_event_id')
        .references((): AnyPgColumn => retentionTriggerEvents.id, { onDelete: 'restrict' }),
    correctionReason: text('correction_reason'),
    actorId: uuid('actor_id').notNull()
        .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    uniqueIndex('retention_trigger_events_archive_revision_unique')
        .on(table.arsipId, table.revision),
    uniqueIndex('retention_trigger_events_identity_archive_unique')
        .on(table.id, table.arsipId),
    index('retention_trigger_events_archive_created_idx').on(table.arsipId, table.createdAt),
    check(
        'retention_trigger_events_type_check',
        sql`${table.eventType} in ('kegiatan_selesai', 'berkas_ditutup', 'serah_terima', 'penetapan', 'lainnya')`,
    ),
    check('retention_trigger_events_revision_check', sql`${table.revision} > 0`),
    check(
        'retention_trigger_events_sha256_check',
        sql`${table.evidenceSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
        'retention_trigger_events_correction_check',
        sql`(
            ${table.revision} = 1
            and ${table.correctsEventId} is null
            and ${table.correctionReason} is null
        ) or (
            ${table.revision} > 1
            and ${table.correctsEventId} is not null
            and length(trim(${table.correctionReason})) >= 10
        )`,
    ),
    check(
        'retention_trigger_events_not_self_correcting_check',
        sql`${table.correctsEventId} is null or ${table.correctsEventId} <> ${table.id}`,
    ),
    foreignKey({
        name: 'retention_trigger_events_correction_same_archive_fk',
        columns: [table.correctsEventId, table.arsipId],
        foreignColumns: [table.id, table.arsipId],
    }).onDelete('restrict'),
]);

/** Verification is a separate immutable attestation from the event author. */
export const retentionTriggerVerifications = pgTable('retention_trigger_verifications', {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull()
        .references(() => retentionTriggerEvents.id, { onDelete: 'restrict' }),
    verdict: varchar('verdict', { length: 20 }).notNull(),
    note: text('note').notNull(),
    verifierId: uuid('verifier_id').notNull()
        .references(() => users.id, { onDelete: 'restrict' }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    uniqueIndex('retention_trigger_verifications_event_unique').on(table.eventId),
    check(
        'retention_trigger_verifications_verdict_check',
        sql`${table.verdict} in ('verified', 'rejected')`,
    ),
    check('retention_trigger_verifications_note_check', sql`length(trim(${table.note})) >= 10`),
]);

/** Immutable header for a permanent-transfer manifest. */
export const permanentTransferManifests = pgTable('permanent_transfer_manifests', {
    id: uuid('id').primaryKey().defaultRandom(),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).notNull()
        .references(() => unitKerja.id, { onDelete: 'restrict' }),
    manifestNumber: varchar('manifest_number', { length: 100 }).notNull(),
    destination: text('destination').notNull(),
    description: text('description'),
    supersedesManifestId: uuid('supersedes_manifest_id')
        .references((): AnyPgColumn => permanentTransferManifests.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by').notNull()
        .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    uniqueIndex('permanent_transfer_manifests_unit_number_unique')
        .on(table.unitKerjaId, table.manifestNumber),
    uniqueIndex('permanent_transfer_manifests_supersedes_unique')
        .on(table.supersedesManifestId)
        .where(sql`${table.supersedesManifestId} is not null`),
    check(
        'permanent_transfer_manifests_destination_check',
        sql`length(trim(${table.destination})) >= 5`,
    ),
    check(
        'permanent_transfer_manifests_not_self_superseding_check',
        sql`${table.supersedesManifestId} is null or ${table.supersedesManifestId} <> ${table.id}`,
    ),
]);

export const permanentTransferManifestItems = pgTable('permanent_transfer_manifest_items', {
    id: uuid('id').primaryKey().defaultRandom(),
    manifestId: uuid('manifest_id').notNull()
        .references(() => permanentTransferManifests.id, { onDelete: 'restrict' }),
    arsipId: uuid('arsip_id').notNull()
        .references(() => arsip.id, { onDelete: 'restrict' }),
    appraisalDecisionId: uuid('appraisal_decision_id').notNull()
        .references(() => jraAppraisalDecisions.id, { onDelete: 'restrict' }),
    objectUri: text('object_uri').notNull(),
    objectSha256: varchar('object_sha256', { length: 64 }).notNull(),
    evidenceAttachmentId: uuid('evidence_attachment_id')
        .references(() => fileAttachments.id, { onDelete: 'restrict' }),
    evidenceVerifiedAt: timestamp('evidence_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    uniqueIndex('permanent_transfer_manifest_items_manifest_archive_unique')
        .on(table.manifestId, table.arsipId),
    index('permanent_transfer_manifest_items_archive_history_idx').on(table.arsipId, table.createdAt),
    check(
        'permanent_transfer_manifest_items_sha256_check',
        sql`${table.objectSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
        'permanent_transfer_manifest_items_evidence_check',
        sql`(${table.evidenceAttachmentId} is null and ${table.evidenceVerifiedAt} is null)
            or (${table.evidenceAttachmentId} is not null and ${table.evidenceVerifiedAt} is not null
                and ${table.objectUri} = ('attachment:' || ${table.evidenceAttachmentId}::text))`,
    ),
]);

/** Handover and acknowledgement are append-only events; status is derived. */
export const permanentTransferEvents = pgTable('permanent_transfer_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    manifestId: uuid('manifest_id').notNull()
        .references(() => permanentTransferManifests.id, { onDelete: 'restrict' }),
    eventType: varchar('event_type', { length: 30 }).notNull(),
    eventAt: timestamp('event_at', { withTimezone: true }).notNull(),
    referenceNumber: varchar('reference_number', { length: 150 }).notNull(),
    counterparty: text('counterparty').notNull(),
    documentUri: text('document_uri').notNull(),
    documentSha256: varchar('document_sha256', { length: 64 }).notNull(),
    evidenceAttachmentId: uuid('evidence_attachment_id')
        .references(() => fileAttachments.id, { onDelete: 'restrict' }),
    evidenceVerifiedAt: timestamp('evidence_verified_at', { withTimezone: true }),
    notes: text('notes'),
    actorId: uuid('actor_id').notNull()
        .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    uniqueIndex('permanent_transfer_events_manifest_type_unique')
        .on(table.manifestId, table.eventType),
    check(
        'permanent_transfer_events_type_check',
        sql`${table.eventType} in ('handover', 'acknowledgement')`,
    ),
    check(
        'permanent_transfer_events_sha256_check',
        sql`${table.documentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
        'permanent_transfer_events_content_check',
        sql`length(trim(${table.referenceNumber})) >= 3
            and length(trim(${table.counterparty})) >= 3
            and length(trim(${table.documentUri})) >= 5`,
    ),
    check(
        'permanent_transfer_events_evidence_check',
        sql`(${table.evidenceAttachmentId} is null and ${table.evidenceVerifiedAt} is null)
            or (${table.evidenceAttachmentId} is not null and ${table.evidenceVerifiedAt} is not null
                and ${table.documentUri} = ('attachment:' || ${table.evidenceAttachmentId}::text))`,
    ),
]);

/**
 * Cancellation is a maker-checker workflow. The request identity and reason
 * remain immutable; a reviewer may transition it once from pending to a final
 * verdict. A new request may be opened after a rejection, while an approval is
 * terminal for the manifest and releases its archive reservations.
 */
export const permanentTransferCancellationRequests = pgTable(
    'permanent_transfer_cancellation_requests',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        manifestId: uuid('manifest_id').notNull()
            .references(() => permanentTransferManifests.id, { onDelete: 'restrict' }),
        reason: text('reason').notNull(),
        requestedBy: uuid('requested_by').notNull()
            .references(() => users.id, { onDelete: 'restrict' }),
        requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
        status: varchar('status', { length: 20 })
            .$type<PermanentTransferCancellationStatus>()
            .default('pending')
            .notNull(),
        reviewedBy: uuid('reviewed_by')
            .references(() => users.id, { onDelete: 'restrict' }),
        reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
        reviewNote: text('review_note'),
    },
    (table) => [
        uniqueIndex('permanent_transfer_cancellation_one_pending_unique')
            .on(table.manifestId)
            .where(sql`${table.status} = 'pending'`),
        uniqueIndex('permanent_transfer_cancellation_one_approved_unique')
            .on(table.manifestId)
            .where(sql`${table.status} = 'approved'`),
        index('permanent_transfer_cancellation_manifest_history_idx')
            .on(table.manifestId, table.requestedAt),
        check(
            'permanent_transfer_cancellation_reason_check',
            sql`length(trim(${table.reason})) >= 20`,
        ),
        check(
            'permanent_transfer_cancellation_status_check',
            sql`${table.status} in ('pending', 'approved', 'rejected')`,
        ),
        check(
            'permanent_transfer_cancellation_review_check',
            sql`(${table.status} = 'pending'
                    and ${table.reviewedBy} is null
                    and ${table.reviewedAt} is null
                    and ${table.reviewNote} is null)
                or (${table.status} in ('approved', 'rejected')
                    and ${table.reviewedBy} is not null
                    and ${table.reviewedAt} is not null
                    and length(trim(${table.reviewNote})) >= 10
                    and ${table.reviewedBy} <> ${table.requestedBy})`,
        ),
    ],
);

export const jraAppraisalCasesRelations = relations(jraAppraisalCases, ({ one, many }) => ({
    arsip: one(arsip, { fields: [jraAppraisalCases.arsipId], references: [arsip.id] }),
    assessor: one(users, {
        fields: [jraAppraisalCases.assessorId],
        references: [users.id],
        relationName: 'jraAppraisalAssessor',
    }),
    reviewer: one(users, {
        fields: [jraAppraisalCases.reviewerId],
        references: [users.id],
        relationName: 'jraAppraisalReviewer',
    }),
    evidence: many(jraAppraisalEvidence),
    decisions: many(jraAppraisalDecisions),
}));

export const jraAppraisalEvidenceRelations = relations(jraAppraisalEvidence, ({ one }) => ({
    appraisalCase: one(jraAppraisalCases, {
        fields: [jraAppraisalEvidence.caseId],
        references: [jraAppraisalCases.id],
    }),
}));

export const retentionTriggerEventsRelations = relations(retentionTriggerEvents, ({ one, many }) => ({
    arsip: one(arsip, { fields: [retentionTriggerEvents.arsipId], references: [arsip.id] }),
    verifications: many(retentionTriggerVerifications),
}));

export const permanentTransferManifestsRelations = relations(
    permanentTransferManifests,
    ({ one, many }) => ({
        unitKerja: one(unitKerja, {
            fields: [permanentTransferManifests.unitKerjaId],
            references: [unitKerja.id],
        }),
        items: many(permanentTransferManifestItems),
        events: many(permanentTransferEvents),
        cancellations: many(permanentTransferCancellationRequests),
    }),
);

export type JraAppraisalCase = typeof jraAppraisalCases.$inferSelect;
export type NewJraAppraisalCase = typeof jraAppraisalCases.$inferInsert;
export type JraAppraisalDecision = typeof jraAppraisalDecisions.$inferSelect;
export type RetentionTriggerEvent = typeof retentionTriggerEvents.$inferSelect;
export type PermanentTransferManifest = typeof permanentTransferManifests.$inferSelect;
