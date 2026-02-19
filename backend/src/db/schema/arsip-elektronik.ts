import { pgTable, uuid, varchar, text, integer, timestamp, date } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { arsip } from './arsip';
import { users } from './users';
import { autentikasi } from './autentikasi';

/**
 * Arsip Elektronik — extended metadata for digitized/electronic archives
 * Tracks format, integrity (hash), digitization details, and verification status
 */
export const arsipElektronik = pgTable('arsip_elektronik', {
    id: uuid('id').primaryKey().defaultRandom(),
    arsipId: uuid('arsip_id').notNull().references(() => arsip.id, { onDelete: 'cascade' }),

    // File metadata
    formatFile: varchar('format_file', { length: 20 }).notNull(), // PDF/A, TIFF, JPEG, PNG, DOCX
    ukuranFile: integer('ukuran_file'), // bytes
    hashSHA256: varchar('hash_sha256', { length: 64 }), // integrity checksum
    algoritmaHash: varchar('algoritma_hash', { length: 20 }).default('SHA-256'), // e.g. SHA-256, MD5
    waktuPembuatanHash: timestamp('waktu_pembuatan_hash'),
    resolusiDPI: integer('resolusi_dpi'), // for scanned docs
    jumlahHalaman: integer('jumlah_halaman'),

    // Media info
    mediaAsal: varchar('media_asal', { length: 30 }).default('kertas'),
    // 'kertas' | 'mikrofilm' | 'digital' | 'foto' | 'video' | 'audio'
    mediaTujuan: varchar('media_tujuan', { length: 30 }).default('digital'),
    // 'digital' | 'mikrofilm'

    // Digitization tracking
    tanggalDigitalisasi: date('tanggal_digitalisasi'),
    didigitalisasiOleh: uuid('didigitalisasi_oleh').references(() => users.id),
    alatDigitalisasi: varchar('alat_digitalisasi', { length: 100 }), // e.g., "Canon DR-C225"
    softwareDigitalisasi: varchar('software_digitalisasi', { length: 100 }), // e.g., "Adobe Acrobat"

    // Verification
    statusVerifikasi: varchar('status_verifikasi', { length: 20 }).default('pending').notNull(),
    // 'pending' | 'verified' | 'rejected'
    verifiedBy: uuid('verified_by').references(() => users.id),
    verifiedAt: timestamp('verified_at'),
    catatanVerifikasi: text('catatan_verifikasi'),

    // Autentikasi (Alih Media)
    autentikasiId: uuid('autentikasi_id').references(() => autentikasi.id),

    // Digital signature
    tandaTanganDigital: text('tanda_tangan_digital'), // signature info / certificate

    // Versioning
    versiDokumen: integer('versi_dokumen').default(1).notNull(),
    catatanKonversi: text('catatan_konversi'), // conversion notes

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const arsipElektronikRelations = relations(arsipElektronik, ({ one }) => ({
    arsip: one(arsip, {
        fields: [arsipElektronik.arsipId],
        references: [arsip.id],
    }),
    digitizedByUser: one(users, {
        fields: [arsipElektronik.didigitalisasiOleh],
        references: [users.id],
        relationName: 'digitizedBy',
    }),
    verifiedByUser: one(users, {
        fields: [arsipElektronik.verifiedBy],
        references: [users.id],
        relationName: 'verifiedBy',
    }),
    autentikasi: one(autentikasi, {
        fields: [arsipElektronik.autentikasiId],
        references: [autentikasi.id],
    }),
}));

export type ArsipElektronik = typeof arsipElektronik.$inferSelect;
export type NewArsipElektronik = typeof arsipElektronik.$inferInsert;
