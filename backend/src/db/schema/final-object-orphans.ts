import { sql } from 'drizzle-orm';
import {
    check,
    index,
    integer,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core';

/**
 * Durable candidates for final-bucket compensation.
 *
 * Scanner promotions insert an exact source/destination identity immediately
 * after copy. API final writes reserve a locator/token before GCS creation, so
 * a crash before the generation response is still recoverable. The domain
 * transaction marks the candidate referenced; the independent cleanup job
 * alone can fence an old unreferenced candidate to deleting.
 */
export const finalObjectOrphans = pgTable('final_object_orphans', {
    id: uuid('id').primaryKey().defaultRandom(),
    attachmentId: uuid('attachment_id').notNull(),
    candidateKind: varchar('candidate_kind', { length: 24 }).default('scanner_promotion').notNull(),
    cleanupToken: uuid('cleanup_token'),
    finalLocator: text('final_locator').notNull(),
    finalObjectGeneration: varchar('final_object_generation', { length: 32 }),
    sourceLocator: text('source_locator'),
    sourceObjectGeneration: varchar('source_object_generation', { length: 32 }),
    status: varchar('status', { length: 24 }).default('pending').notNull(),
    notBefore: timestamp('not_before', { withTimezone: true }).defaultNow().notNull(),
    cleanupStartedAt: timestamp('cleanup_started_at', { withTimezone: true }),
    attempts: integer('attempts').default(0).notNull(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    uniqueIndex('final_object_orphans_object_unique').on(
        table.finalLocator,
        table.finalObjectGeneration,
    ),
    uniqueIndex('final_object_orphans_locator_unique').on(table.finalLocator),
    uniqueIndex('final_object_orphans_cleanup_token_unique')
        .on(table.cleanupToken)
        .where(sql`${table.cleanupToken} is not null`),
    index('final_object_orphans_cleanup_idx').on(table.status, table.notBefore, table.createdAt),
    check(
        'final_object_orphans_locator_check',
        sql`${table.finalLocator} like 'gs://%' and (${table.sourceLocator} is null or ${table.sourceLocator} like 'gs://%')`,
    ),
    check(
        'final_object_orphans_generation_check',
        sql`(${table.finalObjectGeneration} is null or ${table.finalObjectGeneration} ~ '^[0-9]+$') and (${table.sourceObjectGeneration} is null or ${table.sourceObjectGeneration} ~ '^[0-9]+$')`,
    ),
    check(
        'final_object_orphans_candidate_kind_check',
        sql`${table.candidateKind} in ('scanner_promotion', 'api_final')`,
    ),
    check(
        'final_object_orphans_identity_check',
        sql`(${table.candidateKind} = 'scanner_promotion' and ${table.cleanupToken} is null and ${table.finalObjectGeneration} is not null and ${table.sourceLocator} is not null and ${table.sourceObjectGeneration} is not null and ${table.status} <> 'reserved') or (${table.candidateKind} = 'api_final' and ${table.cleanupToken} is not null and ${table.sourceLocator} is null and ${table.sourceObjectGeneration} is null)`,
    ),
    check(
        'final_object_orphans_status_check',
        sql`${table.status} in ('reserved', 'pending', 'reference_check', 'deleting', 'retry', 'deleted', 'referenced', 'not_found', 'identity_mismatch', 'failed')`,
    ),
    check('final_object_orphans_attempts_check', sql`${table.attempts} >= 0`),
]);

export type FinalObjectOrphan = typeof finalObjectOrphans.$inferSelect;
export type NewFinalObjectOrphan = typeof finalObjectOrphans.$inferInsert;
