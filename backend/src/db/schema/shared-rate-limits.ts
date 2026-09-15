import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';

export const sharedRateLimits = pgTable('shared_rate_limits', {
    bucket: varchar('bucket', { length: 64 }).notNull(),
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    hits: integer('hits').notNull(),
    resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
}, table => [
    primaryKey({ columns: [table.bucket, table.keyHash] }),
    index('shared_rate_limits_expiry_idx').on(table.resetAt),
    check('shared_rate_limits_bucket_check', sql`${table.bucket} ~ '^[a-z][a-z0-9_-]{0,63}$'`),
    check('shared_rate_limits_key_check', sql`${table.keyHash} ~ '^[a-f0-9]{64}$'`),
    check('shared_rate_limits_hits_check', sql`${table.hits} >= 0`),
]);
