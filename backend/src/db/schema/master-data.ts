import { pgTable, serial, varchar, text, integer, boolean } from 'drizzle-orm/pg-core';

// Master data klasifikasi arsip (Permen 10/2018)
export const klasifikasiArsip = pgTable('klasifikasi_arsip', {
    id: serial('id').primaryKey(),
    kode: varchar('kode', { length: 50 }).unique().notNull(),
    jenis: text('jenis').notNull(),
    keterangan: text('keterangan'),
    kategori: varchar('kategori', { length: 100 }),
    parentKode: varchar('parent_kode', { length: 50 }),
    tipe: varchar('tipe', { length: 20 }).notNull(), // 'fasilitatif', 'substantif'
    level: integer('level').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
});

// Master data jadwal retensi arsip - JRA (Permen 8/2020)
export const jadwalRetensiArsip = pgTable('jadwal_retensi_arsip', {
    id: serial('id').primaryKey(),
    kode: varchar('kode', { length: 50 }).unique().notNull(),
    uraian: text('uraian').notNull(),
    retensiAktif: varchar('retensi_aktif', { length: 150 }),
    retensiInaktif: varchar('retensi_inaktif', { length: 150 }),
    keterangan: text('keterangan'),
    kategori: varchar('kategori', { length: 100 }),
    parentKode: varchar('parent_kode', { length: 50 }),
    tipe: varchar('tipe', { length: 20 }).notNull(), // 'fasilitatif', 'substantif'
    level: integer('level').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
});

export type KlasifikasiArsip = typeof klasifikasiArsip.$inferSelect;
export type NewKlasifikasiArsip = typeof klasifikasiArsip.$inferInsert;
export type JadwalRetensiArsip = typeof jadwalRetensiArsip.$inferSelect;
export type NewJadwalRetensiArsip = typeof jadwalRetensiArsip.$inferInsert;
