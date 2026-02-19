import { pgTable, uuid, varchar, text, integer, timestamp, date } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { arsipElektronik } from './arsip-elektronik';

/**
 * Autentikasi — Berita Acara Autentikasi Arsip Hasil Alih Media
 * Lampiran II.A.5.e
 */
export const autentikasi = pgTable('autentikasi', {
    id: uuid('id').primaryKey().defaultRandom(),

    // Header Berita Acara
    nomorBeritaAcara: varchar('nomor_berita_acara', { length: 100 }).notNull(),
    tanggalAutentikasi: date('tanggal_autentikasi').notNull(),
    tempatDilakukan: varchar('tempat_dilakukan', { length: 150 }).default('Kantor Pertanahan'),

    // Pihak yang melakukan autentikasi (biasanya Pejabat Fungsional Arsiparis / Pimpinan)
    dilakukanOleh: uuid('dilakukan_oleh').references(() => users.id),
    jabatanPenandaTangan: varchar('jabatan_penanda_tangan', { length: 100 }), // e.g. "Kepala Seksi Penetapan Hak"

    // Detail Kegiatan
    kegiatan: varchar('kegiatan', { length: 255 }).notNull(), // e.g. "Alih Media Arsip Warkah Tahun 2024"
    jumlahArsip: integer('jumlah_arsip').notNull(),

    // Dokumen Hasil (PDF)
    fileLampiran: varchar('file_lampiran', { length: 255 }), // Path to generated PDF

    // Metadata
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const autentikasiRelations = relations(autentikasi, ({ one, many }) => ({
    petugas: one(users, {
        fields: [autentikasi.dilakukanOleh],
        references: [users.id],
    }),
    itemArsip: many(arsipElektronik)
}));

export type Autentikasi = typeof autentikasi.$inferSelect;
export type NewAutentikasi = typeof autentikasi.$inferInsert;
