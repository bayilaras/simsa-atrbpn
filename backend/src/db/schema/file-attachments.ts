import { pgTable, uuid, varchar, text, bigint, timestamp } from 'drizzle-orm/pg-core';

export const fileAttachments = pgTable('file_attachments', {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: varchar('entity_type', { length: 20 }).notNull(), // 'surat_masuk', 'surat_keluar', 'arsip'
    entityId: uuid('entity_id').notNull(),
    fileName: varchar('file_name', { length: 255 }),
    fileUrl: text('file_url'),
    driveFileId: varchar('drive_file_id', { length: 255 }),
    mimeType: varchar('mime_type', { length: 100 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type FileAttachment = typeof fileAttachments.$inferSelect;
export type NewFileAttachment = typeof fileAttachments.$inferInsert;
