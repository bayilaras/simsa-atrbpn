import { pgTable, uuid, varchar, text, integer, timestamp, date, boolean, check, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { arsip } from './arsip.js';
import { users } from './users.js';
import { autentikasi } from './autentikasi.js';
import { fileAttachments } from './file-attachments.js';

/**
 * Arsip Elektronik — extended metadata for digitized/electronic archives
 * Tracks format, integrity (hash), digitization details, and verification status
 */
export const arsipElektronik = pgTable('arsip_elektronik', {
    id: uuid('id').primaryKey().defaultRandom(),
    arsipId: uuid('arsip_id').notNull().references(() => arsip.id, { onDelete: 'cascade' }),
    fileAttachmentId: uuid('file_attachment_id').references(() => fileAttachments.id, { onDelete: 'restrict' }),
    registrationCode: varchar('registration_code', { length: 100 }),

    // File metadata
    formatFile: varchar('format_file', { length: 20 }).notNull(), // PDF/A, TIFF, JPEG, PNG, DOCX
    ukuranFile: integer('ukuran_file'), // bytes
    hashSHA256: varchar('hash_sha256', { length: 64 }), // integrity checksum
    algoritmaHash: varchar('algoritma_hash', { length: 20 }).default('SHA-256'), // e.g. SHA-256, MD5
    waktuPembuatanHash: timestamp('waktu_pembuatan_hash'),
    resolusiDPI: integer('resolusi_dpi'), // for scanned docs
    jumlahHalaman: integer('jumlah_halaman'),
    colorDepth: integer('color_depth'),
    scanCategory: varchar('scan_category', { length: 30 }).default('paper'),
    // 'paper' | 'cartographic' | 'photo' | 'born_digital'
    sourceType: varchar('source_type', { length: 30 }).default('digitized').notNull(),
    // 'digitized' | 'born_digital' | 'received'
    qcStatus: varchar('qc_status', { length: 20 }).default('pending').notNull(),
    qcNotes: text('qc_notes'),

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
    immutable: boolean('immutable').default(false).notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
    uniqueIndex('arsip_elektronik_attachment_unique').on(table.fileAttachmentId),
    uniqueIndex('arsip_elektronik_registration_code_unique').on(table.registrationCode),
    uniqueIndex('arsip_elektronik_arsip_version_unique').on(table.arsipId, table.versiDokumen),
    check(
        'arsip_elektronik_source_type_check',
        sql`${table.sourceType} in ('digitized', 'born_digital', 'received')`,
    ),
    check(
        'arsip_elektronik_scan_category_check',
        sql`${table.scanCategory} is null or ${table.scanCategory} in ('paper', 'cartographic', 'photo', 'born_digital')`,
    ),
    check(
        'arsip_elektronik_qc_status_check',
        sql`${table.qcStatus} in ('pending', 'passed', 'failed')`,
    ),
]);

export const arsipElektronikRelations = relations(arsipElektronik, ({ one }) => ({
    arsip: one(arsip, {
        fields: [arsipElektronik.arsipId],
        references: [arsip.id],
    }),
    fileAttachment: one(fileAttachments, {
        fields: [arsipElektronik.fileAttachmentId],
        references: [fileAttachments.id],
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
