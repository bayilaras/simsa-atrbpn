import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, primaryKey, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const OPERATIONAL_WORKERS = ['malware-scan', 'srikandi'] as const;
export type OperationalWorker = typeof OPERATIONAL_WORKERS[number];

export const operationalHeartbeats = pgTable('operational_heartbeats', {
    worker: varchar('worker', { length: 40 })
        .$type<OperationalWorker>()
        .notNull(),
    instanceId: uuid('instance_id').notNull(),
    status: varchar('status', { length: 20 })
        .$type<'running' | 'degraded' | 'stopped'>()
        .notNull(),
    details: jsonb('details').$type<Record<string, unknown>>(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    check(
        'operational_heartbeats_worker_check',
        sql`${table.worker} in ('malware-scan', 'srikandi')`,
    ),
    check(
        'operational_heartbeats_status_check',
        sql`${table.status} in ('running', 'degraded', 'stopped')`,
    ),
    index('operational_heartbeats_last_seen_idx').on(table.lastSeenAt),
    index('operational_heartbeats_worker_seen_idx').on(table.worker, table.lastSeenAt),
    primaryKey({
        name: 'operational_heartbeats_worker_instance_pk',
        columns: [table.worker, table.instanceId],
    }),
]);

export type OperationalHeartbeat = typeof operationalHeartbeats.$inferSelect;
