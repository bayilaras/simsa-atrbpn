import { pgTable, serial, varchar, text, boolean } from 'drizzle-orm/pg-core';

// Mapping tematik antara Klasifikasi Arsip (Permen 10/2018) dan JRA (Permen 8/2020)
// Karena kedua sistem menggunakan kode berbeda, mapping ini menghubungkan
// prefix klasifikasi ke prefix JRA berdasarkan kesamaan area/tema
export const klasifikasiJraMapping = pgTable('klasifikasi_jra_mapping', {
    id: serial('id').primaryKey(),
    klasifikasiPrefix: varchar('klasifikasi_prefix', { length: 20 }).notNull(),
    jraPrefix: varchar('jra_prefix', { length: 20 }).notNull(),
    tema: varchar('tema', { length: 100 }).notNull(),
    keterangan: text('keterangan'),
    isActive: boolean('is_active').default(true).notNull(),
});

export type KlasifikasiJraMapping = typeof klasifikasiJraMapping.$inferSelect;
export type NewKlasifikasiJraMapping = typeof klasifikasiJraMapping.$inferInsert;
