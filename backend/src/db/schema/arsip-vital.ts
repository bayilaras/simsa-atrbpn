import { pgTable, uuid, varchar, text, date, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { arsip } from './arsip';
import { unitKerja } from './unit-kerja';
import { users } from './users';

/**
 * Arsip Vital - Archives critical to institutional operations
 * Reference: UU 43/2009 Pasal 1 Angka 5, PP 28/2012
 * 
 * Arsip vital = arsip yang keberadaannya merupakan persyaratan dasar
 * bagi kelangsungan operasional organisasi, tidak dapat diperbaharui,
 * dan tidak tergantikan apabila rusak atau hilang.
 */
export const arsipVital = pgTable('arsip_vital', {
    id: uuid('id').primaryKey().defaultRandom(),
    arsipId: uuid('arsip_id').notNull().references(() => arsip.id, { onDelete: 'restrict' }),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).notNull().references(() => unitKerja.id),

    // Kategori & Tingkat Kekritisan
    kategoriVital: varchar('kategori_vital', { length: 30 }).notNull(),
    // 'hak_keperdataan' | 'operasional' | 'keuangan' | 'keamanan'
    tingkatKekritisan: varchar('tingkat_kekritisan', { length: 20 }).notNull(),
    // 'sangat_kritis' | 'kritis' | 'penting'
    alasanPenetapan: text('alasan_penetapan'),

    // Proteksi
    metodeProteksi: varchar('metode_proteksi', { length: 20 }),
    // 'duplikasi' | 'dispersal' | 'vault' | 'digital_backup'
    lokasiBackup: varchar('lokasi_backup', { length: 255 }),
    mediaBackup: varchar('media_backup', { length: 100 }),
    // eg: 'Hard Drive', 'Cloud Storage', 'Microfilm', 'Safe Deposit Box'
    jadwalBackup: varchar('jadwal_backup', { length: 20 }),
    // 'harian' | 'mingguan' | 'bulanan' | 'tahunan'

    // Monitoring & Review
    tanggalPenetapan: date('tanggal_penetapan'),
    tanggalReviewSelanjutnya: date('tanggal_review_selanjutnya'),
    statusProteksi: varchar('status_proteksi', { length: 20 }).default('belum_diproteksi').notNull(),
    // 'terlindungi' | 'perlu_review' | 'belum_diproteksi'
    penanggungJawab: varchar('penanggung_jawab', { length: 255 }),

    // Tracking
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Relations
export const arsipVitalRelations = relations(arsipVital, ({ one }) => ({
    arsip: one(arsip, {
        fields: [arsipVital.arsipId],
        references: [arsip.id],
    }),
    unitKerja: one(unitKerja, {
        fields: [arsipVital.unitKerjaId],
        references: [unitKerja.id],
    }),
    createdByUser: one(users, {
        fields: [arsipVital.createdBy],
        references: [users.id],
    }),
}));

export type ArsipVital = typeof arsipVital.$inferSelect;
export type NewArsipVital = typeof arsipVital.$inferInsert;
