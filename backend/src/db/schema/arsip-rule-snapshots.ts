import {
    pgTable,
    uuid,
    integer,
    varchar,
    text,
    jsonb,
    timestamp,
    uniqueIndex,
    check,
    foreignKey,
    type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { arsip } from './arsip';
import { users } from './users';
import { klasifikasiArsip, jadwalRetensiArsip } from './master-data';
import { regulatoryRuleSets } from './regulatory-rule-sets';

/**
 * Append-only evidence of the classification and retention rule applied to an
 * archive.  A correction creates a new revision; it never rewrites the legal
 * context that was used by an earlier decision.
 */
export const arsipRuleSnapshots = pgTable('arsip_rule_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    arsipId: uuid('arsip_id').notNull()
        .references(() => arsip.id, { onDelete: 'restrict' }),
    revision: integer('revision').notNull(),
    status: varchar('status', { length: 30 }).notNull(),
    klasifikasiItemId: integer('klasifikasi_item_id')
        .references(() => klasifikasiArsip.id, { onDelete: 'restrict' }),
    klasifikasiRuleSetId: uuid('klasifikasi_rule_set_id')
        .references(() => regulatoryRuleSets.id, { onDelete: 'restrict' }),
    jraItemId: integer('jra_item_id')
        .references(() => jadwalRetensiArsip.id, { onDelete: 'restrict' }),
    jraRuleSetId: uuid('jra_rule_set_id')
        .references(() => regulatoryRuleSets.id, { onDelete: 'restrict' }),
    snapshot: jsonb('snapshot').notNull(),
    snapshotSha256: varchar('snapshot_sha256', { length: 64 }).notNull(),
    supersedesSnapshotId: uuid('supersedes_snapshot_id')
        .references((): AnyPgColumn => arsipRuleSnapshots.id, { onDelete: 'restrict' }),
    reason: text('reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
    uniqueIndex('arsip_rule_snapshots_revision_unique').on(table.arsipId, table.revision),
    uniqueIndex('arsip_rule_snapshots_id_arsip_unique').on(table.id, table.arsipId),
    check(
        'arsip_rule_snapshots_status_check',
        sql`${table.status} in ('verified', 'pending_jra', 'legacy_unverified')`,
    ),
    check(
        'arsip_rule_snapshots_sha256_check',
        sql`${table.snapshotSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
        'arsip_rule_snapshots_revision_positive_check',
        sql`${table.revision} > 0`,
    ),
    check(
        'arsip_rule_snapshots_klasifikasi_pair_check',
        sql`(${table.klasifikasiItemId} is null) = (${table.klasifikasiRuleSetId} is null)`,
    ),
    check(
        'arsip_rule_snapshots_jra_pair_check',
        sql`(${table.jraItemId} is null) = (${table.jraRuleSetId} is null)`,
    ),
    check(
        'arsip_rule_snapshots_not_self_superseding_check',
        sql`${table.supersedesSnapshotId} is null or ${table.supersedesSnapshotId} <> ${table.id}`,
    ),
    foreignKey({
        name: 'arsip_rule_snapshots_klasifikasi_item_set_fk',
        columns: [table.klasifikasiItemId, table.klasifikasiRuleSetId],
        foreignColumns: [klasifikasiArsip.id, klasifikasiArsip.ruleSetId],
    }).onDelete('restrict'),
    foreignKey({
        name: 'arsip_rule_snapshots_jra_item_set_fk',
        columns: [table.jraItemId, table.jraRuleSetId],
        foreignColumns: [jadwalRetensiArsip.id, jadwalRetensiArsip.ruleSetId],
    }).onDelete('restrict'),
    foreignKey({
        name: 'arsip_rule_snapshots_supersedes_same_arsip_fk',
        columns: [table.supersedesSnapshotId, table.arsipId],
        foreignColumns: [table.id, table.arsipId],
    }).onDelete('restrict'),
]);

export type ArsipRuleSnapshot = typeof arsipRuleSnapshots.$inferSelect;
export type NewArsipRuleSnapshot = typeof arsipRuleSnapshots.$inferInsert;
