import { pgTable, uuid, varchar, text, integer, timestamp, date, bigint, check } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users.js';
import { arsipElektronik } from './arsip-elektronik.js';

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
    // Internal private-Blob locator. It is never returned as an access URL;
    // authenticated routes proxy the object stream instead.
    fileLampiran: text('file_lampiran'),
    fileLampiranSha256: varchar('file_lampiran_sha256', { length: 64 }),
    fileLampiranSizeBytes: bigint('file_lampiran_size_bytes', { mode: 'number' }),

    // Metadata
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
    check(
        'autentikasi_file_lampiran_sha256_check',
        sql`${table.fileLampiranSha256} is null or ${table.fileLampiranSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
        'autentikasi_file_lampiran_metadata_check',
        sql`(${table.fileLampiran} is null and ${table.fileLampiranSha256} is null and ${table.fileLampiranSizeBytes} is null)
            or (${table.fileLampiran} is not null and ${table.fileLampiranSha256} is not null and ${table.fileLampiranSizeBytes} > 0)`,
    ),
]);

export const autentikasiRelations = relations(autentikasi, ({ one, many }) => ({
    petugas: one(users, {
        fields: [autentikasi.dilakukanOleh],
        references: [users.id],
    }),
    itemArsip: many(arsipElektronik)
}));

export type Autentikasi = typeof autentikasi.$inferSelect;
export type NewAutentikasi = typeof autentikasi.$inferInsert;
