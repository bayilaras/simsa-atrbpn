import {
    pgTable,
    uuid,
    varchar,
    text,
    integer,
    timestamp,
    jsonb,
    index,
    uniqueIndex,
    check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { regulatoryRuleSets } from './regulatory-rule-sets';

/**
 * Tamper-evident, append-only audit chain for regulatory master data.  These
 * rows are written inside the same transaction as the governed mutation, so a
 * classification/JRA change cannot commit without its before/after evidence.
 */
export const regulatoryRuleEvents = pgTable('regulatory_rule_events', {
    id: uuid('id').primaryKey(),
    ruleSetId: uuid('rule_set_id').notNull()
        .references(() => regulatoryRuleSets.id, { onDelete: 'restrict' }),
    instrumentType: varchar('instrument_type', { length: 30 }).notNull(),
    entityType: varchar('entity_type', { length: 30 }).notNull(),
    itemId: integer('item_id'),
    itemCode: varchar('item_code', { length: 50 }),
    action: varchar('action', { length: 50 }).notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'restrict' }),
    actorEmail: varchar('actor_email', { length: 255 }),
    ipAddress: varchar('ip_address', { length: 45 }),
    previousEventHash: varchar('previous_event_hash', { length: 64 }),
    eventHash: varchar('event_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (table) => [
    index('regulatory_rule_events_set_time_idx').on(table.ruleSetId, table.createdAt),
    index('regulatory_rule_events_item_idx').on(table.instrumentType, table.itemId),
    uniqueIndex('regulatory_rule_events_event_hash_unique').on(table.eventHash),
    uniqueIndex('regulatory_rule_events_previous_hash_unique')
        .on(table.ruleSetId, table.previousEventHash)
        .where(sql`${table.previousEventHash} is not null`),
    uniqueIndex('regulatory_rule_events_genesis_unique')
        .on(table.ruleSetId)
        .where(sql`${table.previousEventHash} is null`),
    check(
        'regulatory_rule_events_instrument_check',
        sql`${table.instrumentType} in ('klasifikasi', 'jra')`,
    ),
    check(
        'regulatory_rule_events_entity_check',
        sql`${table.entityType} in ('rule_set', 'item', 'source_document', 'manifest', 'impact')`,
    ),
    check(
        'regulatory_rule_events_hash_check',
        sql`${table.eventHash} ~ '^[0-9a-f]{64}$' and (${table.previousEventHash} is null or ${table.previousEventHash} ~ '^[0-9a-f]{64}$')`,
    ),
]);

export type RegulatoryRuleEvent = typeof regulatoryRuleEvents.$inferSelect;
export type NewRegulatoryRuleEvent = typeof regulatoryRuleEvents.$inferInsert;
