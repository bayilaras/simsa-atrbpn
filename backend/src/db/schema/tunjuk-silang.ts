import { pgTable, uuid, varchar, text, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { sql } from 'drizzle-orm';

/**
 * Tunjuk Silang — Cross-reference registry between entities
 * Links arsip, surat masuk, surat keluar, and dosir to each other
 * Supports typed relationships (balasan, tindak_lanjut, referensi, etc.)
 */
export const tunjukSilang = pgTable('tunjuk_silang', {
    id: uuid('id').primaryKey().defaultRandom(),

    // Source entity
    sourceType: varchar('source_type', { length: 20 }).notNull(),
    // 'arsip' | 'surat_masuk' | 'surat_keluar' | 'dosir'
    sourceId: uuid('source_id').notNull(),

    // Target entity
    targetType: varchar('target_type', { length: 20 }).notNull(),
    // 'arsip' | 'surat_masuk' | 'surat_keluar' | 'dosir'
    targetId: uuid('target_id').notNull(),

    // Relation metadata
    jenisRelasi: varchar('jenis_relasi', { length: 30 }).notNull(),
    // 'balasan' | 'tindak_lanjut' | 'lampiran' | 'referensi' | 'revisi' | 'duplikat' | 'berkaitan'
    keterangan: text('keterangan'),

    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    cancelledAt: timestamp('cancelled_at'),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancellationReason: text('cancellation_reason'),
}, (table) => [
    uniqueIndex('tunjuk_silang_active_unique_idx')
        .on(table.sourceType, table.sourceId, table.targetType, table.targetId, table.jenisRelasi)
        .where(sql`${table.cancelledAt} is null`),
    index('tunjuk_silang_cancelled_at_idx').on(table.cancelledAt),
    check(
        'tunjuk_silang_cancellation_trace_check',
        sql`(
            ${table.cancelledAt} is null
            and ${table.cancelledBy} is null
            and ${table.cancellationReason} is null
        ) or (
            ${table.cancelledAt} is not null
            and ${table.cancelledBy} is not null
            and coalesce(length(trim(${table.cancellationReason})), 0) >= 10
        )`,
    ),
]);

export type TunjukSilang = typeof tunjukSilang.$inferSelect;
export type NewTunjukSilang = typeof tunjukSilang.$inferInsert;
