import { sql } from 'drizzle-orm';
import { check, index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { fileAttachments } from './file-attachments.js';

export const fileFixityJobs = pgTable('file_fixity_jobs', {
    attachmentId: uuid('attachment_id').primaryKey().references(() => fileAttachments.id, { onDelete: 'cascade' }),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true }).notNull().defaultNow(),
    claimToken: uuid('claim_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastResult: varchar('last_result', { length: 20 }),
    lastErrorCode: varchar('last_error_code', { length: 60 }),
}, table => [
    index('file_fixity_jobs_due_idx').on(table.nextCheckAt, table.attachmentId),
    check('file_fixity_jobs_claim_check', sql`(${table.claimToken} is null) = (${table.leaseExpiresAt} is null)`),
    check('file_fixity_jobs_result_check', sql`${table.lastResult} in ('match','mismatch','error','stale')`),
]);
