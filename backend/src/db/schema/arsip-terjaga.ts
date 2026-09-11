import { pgTable, uuid, varchar, text, date, integer, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { arsip } from './arsip';
import { unitKerja } from './unit-kerja';
import { users } from './users';
import { fileAttachments } from './file-attachments';

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
    // belum_dilaporkan | dicatat | dikirim | diterima | bukti_diverifikasi
    legacyReporting: jsonb('legacy_reporting').$type<Record<string, unknown>>(),
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

export interface TerjagaReportEvidence {
    attachmentId: string;
    fileName: string | null;
    sha256: string;
    sizeBytes: number | null;
    objectGeneration: string | null;
    uploadedBy: string | null;
    checkedAt: string;
}

/** Local evidence ledger. 'verified' means independent internal review, never ANRI certification. */
export const arsipTerjagaReports = pgTable('arsip_terjaga_reports', {
    id: uuid('id').primaryKey().defaultRandom(),
    designationId: uuid('designation_id').notNull().references(() => arsipTerjaga.id, { onDelete: 'restrict' }),
    nomorLaporan: varchar('nomor_laporan', { length: 100 }).notNull(),
    tanggalPelaporan: date('tanggal_pelaporan').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAttachmentId: uuid('sent_attachment_id').references(() => fileAttachments.id, { onDelete: 'restrict' }),
    sentEvidence: jsonb('sent_evidence').$type<TerjagaReportEvidence>(),
    sentBy: uuid('sent_by').references(() => users.id, { onDelete: 'restrict' }),
    sentOn: date('sent_on'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    sentNotes: text('sent_notes'),
    receivedAttachmentId: uuid('received_attachment_id').references(() => fileAttachments.id, { onDelete: 'restrict' }),
    receivedEvidence: jsonb('received_evidence').$type<TerjagaReportEvidence>(),
    receivedBy: uuid('received_by').references(() => users.id, { onDelete: 'restrict' }),
    receivedOn: date('received_on'),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    receivedNotes: text('received_notes'),
    verifiedBy: uuid('verified_by').references(() => users.id, { onDelete: 'restrict' }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verificationNotes: text('verification_notes'),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'restrict' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationNotes: text('cancellation_notes'),
}, table => [
    uniqueIndex('arsip_terjaga_reports_open_uidx').on(table.designationId)
        .where(sql`${table.status} in ('draft', 'sent', 'received')`),
]);

export type TerjagaReport = typeof arsipTerjagaReports.$inferSelect;
