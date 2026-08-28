import { sql } from 'drizzle-orm';
import {
    check,
    index,
    integer,
    pgTable,
    smallint,
    timestamp,
    unique,
    uuid,
} from 'drizzle-orm/pg-core';
import { bulkUploadItems } from './bulk-upload.js';

/**
 * Database-authoritative OCR capacity. A singleton row is locked briefly for
 * every acquire so independent API instances cannot oversubscribe Tesseract.
 */
export const ocrCapacityControl = pgTable('ocr_capacity_control', {
    singletonId: smallint('singleton_id').primaryKey().default(1),
    maxConcurrency: integer('max_concurrency').notNull().default(2),
    leaseDurationSeconds: integer('lease_duration_seconds').notNull().default(360),
    retryAfterSeconds: integer('retry_after_seconds').notNull().default(5),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    check('ocr_capacity_control_singleton_check', sql`${table.singletonId} = 1`),
    check(
        'ocr_capacity_control_max_concurrency_check',
        sql`${table.maxConcurrency} between 1 and 16`,
    ),
    check(
        'ocr_capacity_control_lease_duration_check',
        sql`${table.leaseDurationSeconds} between 240 and 900`,
    ),
    check(
        'ocr_capacity_control_retry_after_check',
        sql`${table.retryAfterSeconds} between 1 and 60`,
    ),
]);

export const ocrProcessingLeases = pgTable('ocr_processing_leases', {
    token: uuid('token').primaryKey(),
    itemId: uuid('item_id')
        .notNull()
        .references(() => bulkUploadItems.id, { onDelete: 'cascade' }),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }).notNull(),
}, (table) => [
    unique('ocr_processing_leases_item_unique').on(table.itemId),
    index('ocr_processing_leases_expiry_idx').on(table.leaseExpiresAt),
    check(
        'ocr_processing_leases_expiry_check',
        sql`${table.leaseExpiresAt} > ${table.acquiredAt}`,
    ),
]);

export type OcrProcessingLeaseRow = typeof ocrProcessingLeases.$inferSelect;
