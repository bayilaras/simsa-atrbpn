import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

export const fileAttachments = pgTable('file_attachments', {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: varchar('entity_type', { length: 20 }).notNull(), // 'surat_masuk', 'surat_keluar', 'arsip'
    entityId: uuid('entity_id').notNull(),
    fileName: varchar('file_name', { length: 255 }),
    fileUrl: text('file_url'),
    objectGeneration: varchar('object_generation', { length: 32 }),
    driveFileId: varchar('drive_file_id', { length: 255 }),
    mimeType: varchar('mime_type', { length: 100 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    sha256: varchar('sha256', { length: 64 }),
    storageAccess: varchar('storage_access', { length: 20 }).default('private').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    integrityStatus: varchar('integrity_status', { length: 30 }).default('unverified').notNull(),
    lastFixityCheckAt: timestamp('last_fixity_check_at'),
    malwareScanStatus: varchar('malware_scan_status', { length: 30 }).default('not_scanned').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
    index('file_attachments_malware_queue_idx').on(
        table.malwareScanStatus,
        table.createdAt,
        table.id,
    ),
    check(
        'file_attachments_object_generation_check',
        sql`(
            ${table.fileUrl} like 'gs://%'
            and ${table.objectGeneration} is not null
            and ${table.objectGeneration} ~ '^[0-9]+$'
        ) or (
            coalesce(${table.fileUrl}, '') not like 'gs://%'
            and ${table.objectGeneration} is null
        )`,
    ),
]);

export type FileAttachment = typeof fileAttachments.$inferSelect;
export type NewFileAttachment = typeof fileAttachments.$inferInsert;
