import { relations, sql } from 'drizzle-orm';
import {
    check,
    pgTable,
    text,
    timestamp,
    uuid,
    varchar,
} from 'drizzle-orm/pg-core';
import { unitKerja } from './unit-kerja';
import { users } from './users';

export type RecordAccessMode = 'view' | 'download' | 'manage';

/**
 * Per-record need-to-know approval for controlled records.
 *
 * A role or database-admin privilege is not treated as a security clearance.
 * Every non-public record must have an explicit, time-bounded grant before its
 * content can be opened or mutated. Rows are retained as decision evidence;
 * revocation/expiry changes status instead of deleting the request.
 */
export const recordAccessGrants = pgTable('record_access_grants', {
    id: uuid('id').primaryKey().defaultRandom(),
    requesterId: uuid('requester_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    targetUserId: uuid('target_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    entityType: varchar('entity_type', { length: 30 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).notNull().references(() => unitKerja.id, { onDelete: 'restrict' }),
    requiredClassification: varchar('required_classification', { length: 30 }).notNull(),
    purpose: text('purpose').notNull(),
    accessMode: varchar('access_mode', { length: 20 })
        .$type<RecordAccessMode>()
        .default('view')
        .notNull(),
    status: varchar('status', { length: 20 }).default('pending').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => users.id, { onDelete: 'restrict' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revocationReason: text('revocation_reason'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    check(
        'record_access_grants_entity_type_check',
        sql`${table.entityType} in ('surat_masuk', 'surat_keluar', 'arsip')`,
    ),
    check(
        'record_access_grants_classification_check',
        sql`${table.requiredClassification} in ('terbatas', 'rahasia', 'sangat_rahasia')`,
    ),
    check(
        'record_access_grants_status_check',
        sql`${table.status} in ('pending', 'approved', 'denied', 'revoked', 'expired')`,
    ),
    check(
        'record_access_grants_purpose_check',
        sql`length(trim(${table.purpose})) >= 20`,
    ),
    check(
        'record_access_grants_access_mode_check',
        sql`${table.accessMode} in ('view', 'download', 'manage')`,
    ),
    check(
        'record_access_grants_decision_check',
        sql`${table.status} not in ('approved', 'denied') or (${table.decidedBy} is not null and ${table.decidedAt} is not null and length(trim(${table.decisionReason})) >= 10)`,
    ),
    check(
        'record_access_grants_approval_expiry_check',
        sql`${table.status} <> 'approved' or (${table.expiresAt} is not null and ${table.expiresAt} > ${table.decidedAt})`,
    ),
    check(
        'record_access_grants_revocation_check',
        sql`${table.status} <> 'revoked' or (${table.revokedBy} is not null and ${table.revokedAt} is not null and length(trim(${table.revocationReason})) >= 10)`,
    ),
]);

export const recordAccessGrantsRelations = relations(recordAccessGrants, ({ one }) => ({
    requester: one(users, {
        fields: [recordAccessGrants.requesterId],
        references: [users.id],
        relationName: 'recordAccessGrantRequester',
    }),
    targetUser: one(users, {
        fields: [recordAccessGrants.targetUserId],
        references: [users.id],
        relationName: 'recordAccessGrantTarget',
    }),
    approver: one(users, {
        fields: [recordAccessGrants.decidedBy],
        references: [users.id],
        relationName: 'recordAccessGrantApprover',
    }),
}));

export type RecordAccessGrant = typeof recordAccessGrants.$inferSelect;
export type NewRecordAccessGrant = typeof recordAccessGrants.$inferInsert;
