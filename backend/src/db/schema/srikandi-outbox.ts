import {
    check,
    index,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { unitKerja } from './unit-kerja.js';
import { users } from './users.js';

export const SRIKANDI_OUTBOX_STATUSES = [
    'pending',
    'processing',
    'retry_scheduled',
    'succeeded',
    'dead_letter',
] as const;

export type SrikandiOutboxStatus = typeof SRIKANDI_OUTBOX_STATUSES[number];

export const SRIKANDI_OUTBOX_AUDIT_EVENTS = [
    'enqueued',
    'claimed',
    'attempt_succeeded',
    'retry_scheduled',
    'dead_lettered',
    'manual_retry',
] as const;

export type SrikandiOutboxAuditEvent = typeof SRIKANDI_OUTBOX_AUDIT_EVENTS[number];

/**
 * Durable integration outbox. The payload is an internal envelope and is not
 * considered synchronized until an explicitly configured official response is
 * validated by the HTTP adapter.
 */
export const srikandiOutbox = pgTable('srikandi_outbox', {
    id: uuid('id').primaryKey().defaultRandom(),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 })
        .notNull()
        .references(() => unitKerja.id),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    contractVersion: varchar('contract_version', { length: 100 }).notNull(),
    messageHash: varchar('message_hash', { length: 64 }).notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    sourceEntityType: varchar('source_entity_type', { length: 50 }).notNull(),
    sourceEntityId: uuid('source_entity_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: varchar('status', { length: 32 })
        .$type<SrikandiOutboxStatus>()
        .notNull()
        .default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lockToken: uuid('lock_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    lastError: text('last_error'),
    lastHttpStatus: integer('last_http_status'),
    responsePayload: jsonb('response_payload').$type<Record<string, unknown>>(),
    remoteId: varchar('remote_id', { length: 255 }),
    officialResponseAt: timestamp('official_response_at', { withTimezone: true }),
    succeededAt: timestamp('succeeded_at', { withTimezone: true }),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('srikandi_outbox_unit_idempotency_uidx')
        .on(table.unitKerjaId, table.idempotencyKey),
    index('srikandi_outbox_due_idx')
        .on(table.status, table.nextAttemptAt),
    index('srikandi_outbox_lease_idx')
        .on(table.status, table.leaseExpiresAt),
    index('srikandi_outbox_unit_created_idx')
        .on(table.unitKerjaId, table.createdAt),
    check(
        'srikandi_outbox_status_check',
        sql`${table.status} in ('pending', 'processing', 'retry_scheduled', 'succeeded', 'dead_letter')`,
    ),
    check(
        'srikandi_outbox_attempt_count_check',
        sql`${table.attemptCount} >= 0 and ${table.maxAttempts} between 1 and 20`,
    ),
    check(
        'srikandi_outbox_contract_version_check',
        sql`length(trim(${table.contractVersion})) between 1 and 100`,
    ),
    check(
        'srikandi_outbox_terminal_state_check',
        sql`(
            ${table.status} <> 'succeeded'
            or (
                ${table.remoteId} is not null
                and length(trim(${table.remoteId})) > 0
                and ${table.officialResponseAt} is not null
                and ${table.succeededAt} is not null
            )
        ) and (
            ${table.status} <> 'dead_letter'
            or (${table.deadLetteredAt} is not null and ${table.lastError} is not null)
        ) and (
            ${table.status} <> 'processing'
            or (
                ${table.lockToken} is not null
                and ${table.leaseExpiresAt} is not null
                and ${table.lastAttemptAt} is not null
            )
        ) and (
            ${table.status} <> 'retry_scheduled'
            or ${table.nextAttemptAt} is not null
        )`,
    ),
]);

/**
 * Append-only audit trail for every state mutation. Each service transition
 * writes this row in the same database transaction as the outbox change, so an
 * audit failure rolls the transition back rather than silently losing evidence.
 */
export const srikandiOutboxAudit = pgTable('srikandi_outbox_audit', {
    id: uuid('id').primaryKey().defaultRandom(),
    outboxId: uuid('outbox_id')
        .notNull()
        .references(() => srikandiOutbox.id),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 })
        .notNull()
        .references(() => unitKerja.id),
    event: varchar('event', { length: 40 })
        .$type<SrikandiOutboxAuditEvent>()
        .notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    details: jsonb('details').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    index('srikandi_outbox_audit_outbox_created_idx')
        .on(table.outboxId, table.createdAt),
    index('srikandi_outbox_audit_unit_created_idx')
        .on(table.unitKerjaId, table.createdAt),
    check(
        'srikandi_outbox_audit_event_check',
        sql`${table.event} in (
            'enqueued',
            'claimed',
            'attempt_succeeded',
            'retry_scheduled',
            'dead_lettered',
            'manual_retry'
        )`,
    ),
]);

export type SrikandiOutbox = typeof srikandiOutbox.$inferSelect;
export type NewSrikandiOutbox = typeof srikandiOutbox.$inferInsert;
export type SrikandiOutboxAudit = typeof srikandiOutboxAudit.$inferSelect;
export type NewSrikandiOutboxAudit = typeof srikandiOutboxAudit.$inferInsert;
