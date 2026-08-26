import {
    pgTable,
    uuid,
    varchar,
    text,
    date,
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
    sourceUrl: text('source_url'),
    status: varchar('status', { length: 20 }).default('draft').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    supersedesId: uuid('supersedes_id'),
    changeSummary: text('change_summary'),
    metadata: jsonb('metadata'),
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
        sql`${table.status} in ('draft', 'active', 'superseded', 'withdrawn')`,
    ),
    check(
        'regulatory_rule_sets_sha256_check',
        sql`${table.sourceDocumentSha256} is null or ${table.sourceDocumentSha256} ~ '^[0-9a-fA-F]{64}$'`,
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
