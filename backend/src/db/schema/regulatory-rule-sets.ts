import {
    pgTable,
    uuid,
    varchar,
    text,
    date,
    integer,
    timestamp,
    jsonb,
    check,
    foreignKey,
    uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

/**
 * Stable identifiers for the instruments that are currently in force.  They
 * are deliberately fixed so legacy installations and repeatable seed jobs
 * attach the same records to the same legal source.
 */
export const KLASIFIKASI_RULE_SET_2018_ID = '10102018-1010-4010-8010-000000000010';
export const JRA_RULE_SET_2020_ID = '08002020-0800-4080-8080-000000000008';

/**
 * A rule set is an immutable, publishable edition of either the archive
 * classification or the retention schedule.  New regulations are prepared
 * as drafts, reviewed, then activated.  Existing archive snapshots continue
 * to point to the edition that governed their registration.
 */
export const regulatoryRuleSets = pgTable('regulatory_rule_sets', {
    id: uuid('id').primaryKey().defaultRandom(),
    instrumentType: varchar('instrument_type', { length: 30 }).notNull(),
    version: varchar('version', { length: 100 }).notNull(),
    name: text('name').notNull(),
    legalBasis: text('legal_basis').notNull(),
    regulationNumber: varchar('regulation_number', { length: 100 }).notNull(),
    sourceDocumentName: text('source_document_name'),
    sourceDocumentSha256: varchar('source_document_sha256', { length: 64 }),
    // Canonical locator of the exact, private, non-overwritable source bytes.
    // It is deliberately removed by the presentation layer before rule sets
    // are returned to clients.
    sourceDocumentBlobUrl: text('source_document_blob_url'),
    sourceDocumentObjectGeneration: varchar('source_document_object_generation', { length: 32 }),
    sourceDocumentMimeType: varchar('source_document_mime_type', { length: 100 }),
    sourceDocumentSizeBytes: integer('source_document_size_bytes'),
    sourceDocumentPageCount: integer('source_document_page_count'),
    sourceDocumentVerifiedAt: timestamp('source_document_verified_at'),
    sourceDocumentVerifiedBy: uuid('source_document_verified_by')
        .references(() => users.id, { onDelete: 'restrict' }),
    sourceUrl: text('source_url'),
    status: varchar('status', { length: 20 }).default('draft').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    supersedesId: uuid('supersedes_id'),
    changeSummary: text('change_summary'),
    metadata: jsonb('metadata'),
    completenessManifest: jsonb('completeness_manifest'),
    completenessManifestSha256: varchar('completeness_manifest_sha256', { length: 64 }),
    completenessVerifiedAt: timestamp('completeness_verified_at'),
    completenessVerifiedBy: uuid('completeness_verified_by')
        .references(() => users.id, { onDelete: 'restrict' }),
    impactReport: jsonb('impact_report'),
    impactReportSha256: varchar('impact_report_sha256', { length: 64 }),
    impactReportGeneratedAt: timestamp('impact_report_generated_at'),
    impactReportGeneratedBy: uuid('impact_report_generated_by')
        .references(() => users.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at'),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'restrict' }),
    submissionNote: text('submission_note'),
    reviewedAt: timestamp('reviewed_at'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'restrict' }),
    reviewNote: text('review_note'),
    approvedAt: timestamp('approved_at'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'restrict' }),
    approvalNote: text('approval_note'),
    publishedAt: timestamp('published_at'),
    // Users are deactivated rather than deleted once they are part of a legal
    // publication trail, so the accountable actor cannot silently disappear.
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
    uniqueIndex('regulatory_rule_sets_type_version_unique')
        .on(table.instrumentType, table.version),
    uniqueIndex('regulatory_rule_sets_one_active_per_type')
        .on(table.instrumentType)
        .where(sql`${table.status} = 'active'`),
    foreignKey({
        name: 'regulatory_rule_sets_supersedes_fk',
        columns: [table.supersedesId],
        foreignColumns: [table.id],
    }).onDelete('restrict'),
    check(
        'regulatory_rule_sets_type_check',
        sql`${table.instrumentType} in ('klasifikasi', 'jra')`,
    ),
    check(
        'regulatory_rule_sets_status_check',
        sql`${table.status} in ('draft', 'submitted', 'reviewed', 'approved', 'active', 'superseded', 'withdrawn')`,
    ),
    check(
        'regulatory_rule_sets_sha256_check',
        sql`${table.sourceDocumentSha256} is null or ${table.sourceDocumentSha256} ~ '^[0-9a-fA-F]{64}$'`,
    ),
    check(
        'regulatory_rule_sets_source_blob_check',
        sql`${table.sourceDocumentBlobUrl} is null or (
            (
                ${table.sourceDocumentBlobUrl} ~ '^https://[^/]+[.]private[.]blob[.]vercel-storage[.]com/regulatory-sources/[0-9a-fA-F-]{36}/[^/?#]+$'
                and ${table.sourceDocumentBlobUrl} like ('https://%.private.blob.vercel-storage.com/regulatory-sources/' || ${table.id}::text || '/%')
            )
            or (
                ${table.sourceDocumentBlobUrl} ~ '^gs://[^/]+/regulatory-sources/[0-9a-fA-F-]{36}/[^/?#]+$'
                and ${table.sourceDocumentBlobUrl} like ('gs://%/regulatory-sources/' || ${table.id}::text || '/%')
            )
        )`,
    ),
    check(
        'regulatory_rule_sets_source_generation_check',
        sql`(
            (${table.sourceDocumentBlobUrl} is null and ${table.sourceDocumentObjectGeneration} is null)
            or (
                ${table.sourceDocumentBlobUrl} like 'gs://%'
                and ${table.sourceDocumentObjectGeneration} is not null
                and ${table.sourceDocumentObjectGeneration} ~ '^[0-9]+$'
            )
            or (
                ${table.sourceDocumentBlobUrl} like 'https://%'
                and ${table.sourceDocumentObjectGeneration} is null
            )
        )`,
    ),
    check(
        'regulatory_rule_sets_source_size_check',
        sql`${table.sourceDocumentSizeBytes} is null or ${table.sourceDocumentSizeBytes} > 0`,
    ),
    check(
        'regulatory_rule_sets_source_pages_check',
        sql`${table.sourceDocumentPageCount} is null or ${table.sourceDocumentPageCount} > 0`,
    ),
    check(
        'regulatory_rule_sets_manifest_sha256_check',
        sql`${table.completenessManifestSha256} is null or ${table.completenessManifestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
        'regulatory_rule_sets_impact_sha256_check',
        sql`${table.impactReportSha256} is null or ${table.impactReportSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
        'regulatory_rule_sets_effective_range_check',
        sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
    check(
        'regulatory_rule_sets_not_self_superseding_check',
        sql`${table.supersedesId} is null or ${table.supersedesId} <> ${table.id}`,
    ),
]);

export type RegulatoryRuleSet = typeof regulatoryRuleSets.$inferSelect;
export type NewRegulatoryRuleSet = typeof regulatoryRuleSets.$inferInsert;
