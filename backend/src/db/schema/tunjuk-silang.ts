import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

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
});

export type TunjukSilang = typeof tunjukSilang.$inferSelect;
export type NewTunjukSilang = typeof tunjukSilang.$inferInsert;
