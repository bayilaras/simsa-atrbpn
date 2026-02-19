import { pgTable, uuid, varchar, text, date, integer, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { arsip } from './arsip';
import { unitKerja } from './unit-kerja';
import { users } from './users';

/**
 * Arsip Terjaga - Protected archives reported to ANRI
 * Reference: UU 43/2009 Pasal 1 Angka 6, Pasal 42-43
 * 
 * Arsip terjaga = arsip negara yang berkaitan dengan keberadaan dan
 * kelangsungan kehidupan bangsa dan negara yang harus dijaga keutuhan,
 * keamanan, dan keselamatannya. Wajib dilaporkan ke ANRI.
 */
export const arsipTerjaga = pgTable('arsip_terjaga', {
    id: uuid('id').primaryKey().defaultRandom(),
    arsipId: uuid('arsip_id').notNull().references(() => arsip.id, { onDelete: 'restrict' }),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).notNull().references(() => unitKerja.id),

    // Kategori & Identifikasi
    kategoriTerjaga: varchar('kategori_terjaga', { length: 30 }).notNull(),
    // 'kekayaan_negara' | 'hak_keperdataan' | 'pertanahan'
    dasarHukum: text('dasar_hukum'),
    uraianIsi: text('uraian_isi'),

    // Pelaporan ANRI
    statusPelaporan: varchar('status_pelaporan', { length: 20 }).default('belum_dilaporkan').notNull(),
    // 'belum_dilaporkan' | 'dilaporkan' | 'terverifikasi'
    tanggalPelaporan: date('tanggal_pelaporan'),
    nomorLaporanANRI: varchar('nomor_laporan_anri', { length: 100 }),
    periodePelaporanHari: integer('periode_pelaporan_hari').default(365),
    // Interval hari untuk pelaporan berikutnya

    // Compliance / Kepatuhan
    tanggalPenetapan: date('tanggal_penetapan'),
    tanggalReviewSelanjutnya: date('tanggal_review_selanjutnya'),
    statusKepatuhan: varchar('status_kepatuhan', { length: 20 }).default('belum_dinilai').notNull(),
    // 'patuh' | 'terlambat' | 'belum_dinilai'
    catatan: text('catatan'),

    // Tracking
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Relations
export const arsipTerjagaRelations = relations(arsipTerjaga, ({ one }) => ({
    arsip: one(arsip, {
        fields: [arsipTerjaga.arsipId],
        references: [arsip.id],
    }),
    unitKerja: one(unitKerja, {
        fields: [arsipTerjaga.unitKerjaId],
        references: [unitKerja.id],
    }),
    createdByUser: one(users, {
        fields: [arsipTerjaga.createdBy],
        references: [users.id],
    }),
}));

export type ArsipTerjaga = typeof arsipTerjaga.$inferSelect;
export type NewArsipTerjaga = typeof arsipTerjaga.$inferInsert;
