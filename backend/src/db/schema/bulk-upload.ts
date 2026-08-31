import {
    bigint,
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
import { relations, sql } from 'drizzle-orm';
import { arsip } from './arsip.js';
import { unitKerja } from './unit-kerja.js';
import { users } from './users.js';

export const bulkUploadBatches = pgTable('bulk_upload_batches', {
    id: uuid('id').primaryKey().defaultRandom(),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 })
        .notNull()
        .references(() => unitKerja.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
        .notNull()
        .references(() => users.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 20 }).default('pending').notNull(),
    totalFiles: integer('total_files').notNull(),
    processedFiles: integer('processed_files').default(0).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('bulk_upload_batches_owner_idx').on(table.createdBy, table.unitKerjaId, table.createdAt),
    uniqueIndex('bulk_upload_batches_one_active_owner_unit_idx')
        .on(table.createdBy, table.unitKerjaId)
        .where(sql`${table.status} in ('pending', 'processing', 'completed', 'partial')`),
    index('bulk_upload_batches_expiry_idx').on(table.status, table.expiresAt),
    check(
        'bulk_upload_batches_status_check',
        sql`${table.status} in ('pending', 'processing', 'completed', 'partial', 'confirmed', 'expired')`,
    ),
    check(
        'bulk_upload_batches_counts_check',
        sql`${table.totalFiles} > 0 and ${table.processedFiles} >= 0 and ${table.processedFiles} <= ${table.totalFiles}`,
    ),
    check(
        'bulk_upload_batches_confirmation_check',
        sql`(${table.status} = 'confirmed') = (${table.confirmedAt} is not null)`,
    ),
]);

export const bulkUploadItems = pgTable('bulk_upload_items', {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
        .notNull()
        .references(() => bulkUploadBatches.id, { onDelete: 'cascade' }),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    blobUrl: text('blob_url').notNull(),
    objectGeneration: varchar('object_generation', { length: 32 }),
    status: varchar('status', { length: 20 }).default('pending').notNull(),
    progress: integer('progress').default(0).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
    arsipId: uuid('arsip_id').references(() => arsip.id, { onDelete: 'restrict' }),
    error: text('error'),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    blobDeletedAt: timestamp('blob_deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index('bulk_upload_items_batch_status_idx').on(table.batchId, table.status),
    uniqueIndex('bulk_upload_items_blob_url_unique').on(table.blobUrl),
    check(
        'bulk_upload_items_status_check',
        sql`${table.status} in ('pending', 'processing', 'completed', 'failed', 'confirmed')`,
    ),
    check('bulk_upload_items_progress_check', sql`${table.progress} between 0 and 100`),
    check('bulk_upload_items_size_check', sql`${table.sizeBytes} > 0`),
    check('bulk_upload_items_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
        'bulk_upload_items_object_generation_check',
        sql`(
            ${table.blobUrl} like 'gs://%'
            and ${table.objectGeneration} is not null
            and ${table.objectGeneration} ~ '^[0-9]+$'
        ) or (
            ${table.blobUrl} not like 'gs://%'
            and ${table.objectGeneration} is null
        )`,
    ),
    check(
        'bulk_upload_items_confirmation_check',
        sql`(${table.status} = 'confirmed') = (${table.arsipId} is not null and ${table.confirmedAt} is not null)`,
    ),
]);

export const bulkUploadBatchRelations = relations(bulkUploadBatches, ({ one, many }) => ({
    unitKerja: one(unitKerja, {
        fields: [bulkUploadBatches.unitKerjaId],
        references: [unitKerja.id],
    }),
    creator: one(users, {
        fields: [bulkUploadBatches.createdBy],
        references: [users.id],
    }),
    items: many(bulkUploadItems),
}));

export const bulkUploadItemRelations = relations(bulkUploadItems, ({ one }) => ({
    batch: one(bulkUploadBatches, {
        fields: [bulkUploadItems.batchId],
        references: [bulkUploadBatches.id],
    }),
    arsip: one(arsip, {
        fields: [bulkUploadItems.arsipId],
        references: [arsip.id],
    }),
}));

export type BulkUploadBatchRow = typeof bulkUploadBatches.$inferSelect;
export type NewBulkUploadBatchRow = typeof bulkUploadBatches.$inferInsert;
export type BulkUploadItemRow = typeof bulkUploadItems.$inferSelect;
export type NewBulkUploadItemRow = typeof bulkUploadItems.$inferInsert;
