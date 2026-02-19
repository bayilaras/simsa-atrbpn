import { pgTable, uuid, varchar, text, date, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { unitKerja } from './unit-kerja';
import { suratMasuk } from './surat-masuk';
import { suratKeluar } from './surat-keluar';

/**
 * Dosir (Case Files) - Groups related surat into case folders
 */
export const dosir = pgTable('dosir', {
    id: uuid('id').primaryKey().defaultRandom(),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).notNull().references(() => unitKerja.id),
    kode: varchar('kode', { length: 50 }).notNull(), // e.g., "PTEP-2026-001"
    judul: varchar('judul', { length: 500 }).notNull(), // Case title
    deskripsi: text('deskripsi'),
    status: varchar('status', { length: 50 }).default('open').notNull(), // open, closed, archived
    kategori: varchar('kategori', { length: 100 }), // Sengketa, Pengadaan, Sertipikat, etc.
    tanggalMulai: date('tanggal_mulai'), // Case start date
    tanggalSelesai: date('tanggal_selesai'), // Case end date (when closed)
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Junction table: dosir <-> surat_masuk (many-to-many)
 */
export const dosirSuratMasuk = pgTable('dosir_surat_masuk', {
    dosirId: uuid('dosir_id').notNull().references(() => dosir.id, { onDelete: 'cascade' }),
    suratMasukId: uuid('surat_masuk_id').notNull().references(() => suratMasuk.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at').defaultNow().notNull(),
    notes: text('notes'), // Optional context for this link
}, (t) => [
    primaryKey({ columns: [t.dosirId, t.suratMasukId] })
]);

/**
 * Junction table: dosir <-> surat_keluar (many-to-many)
 */
export const dosirSuratKeluar = pgTable('dosir_surat_keluar', {
    dosirId: uuid('dosir_id').notNull().references(() => dosir.id, { onDelete: 'cascade' }),
    suratKeluarId: uuid('surat_keluar_id').notNull().references(() => suratKeluar.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at').defaultNow().notNull(),
    notes: text('notes'),
}, (t) => [
    primaryKey({ columns: [t.dosirId, t.suratKeluarId] })
]);

// Relations
export const dosirRelations = relations(dosir, ({ one, many }) => ({
    unitKerja: one(unitKerja, {
        fields: [dosir.unitKerjaId],
        references: [unitKerja.id],
    }),
    createdByUser: one(users, {
        fields: [dosir.createdBy],
        references: [users.id],
    }),
    suratMasukLinks: many(dosirSuratMasuk),
    suratKeluarLinks: many(dosirSuratKeluar),
}));

export const dosirSuratMasukRelations = relations(dosirSuratMasuk, ({ one }) => ({
    dosir: one(dosir, {
        fields: [dosirSuratMasuk.dosirId],
        references: [dosir.id],
    }),
    suratMasuk: one(suratMasuk, {
        fields: [dosirSuratMasuk.suratMasukId],
        references: [suratMasuk.id],
    }),
}));

export const dosirSuratKeluarRelations = relations(dosirSuratKeluar, ({ one }) => ({
    dosir: one(dosir, {
        fields: [dosirSuratKeluar.dosirId],
        references: [dosir.id],
    }),
    suratKeluar: one(suratKeluar, {
        fields: [dosirSuratKeluar.suratKeluarId],
        references: [suratKeluar.id],
    }),
}));

// Types
export type Dosir = typeof dosir.$inferSelect;
export type NewDosir = typeof dosir.$inferInsert;
export type DosirSuratMasuk = typeof dosirSuratMasuk.$inferSelect;
export type DosirSuratKeluar = typeof dosirSuratKeluar.$inferSelect;
