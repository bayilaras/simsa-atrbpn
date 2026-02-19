import { pgTable, uuid, varchar, text, date, boolean, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';
import { unitKerja } from './unit-kerja';
import { suratMasuk } from './surat-masuk';
import { approvalRequests } from './approvals';
import { digitalSignatures } from './signatures';
import { relations } from 'drizzle-orm';

export const suratKeluar = pgTable('surat_keluar', {
    id: uuid('id').primaryKey().defaultRandom(),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).notNull().references(() => unitKerja.id),
    noUrut: integer('no_urut').notNull(),
    tahun: integer('tahun').notNull(),
    naskahDinas: varchar('naskah_dinas', { length: 100 }), // Surat Dinas, Nota Dinas, Surat Tugas, etc
    nomorSurat: varchar('nomor_surat', { length: 255 }),
    tanggalSurat: date('tanggal_surat'),
    perihal: text('perihal'),
    kepada: text('kepada'),
    linkDokumen: text('link_dokumen'),
    balasanUntuk: uuid('balasan_untuk').references(() => suratMasuk.id),
    // Klasifikasi fields
    klasifikasiFasilitatifKode: varchar('klasifikasi_fasilitatif_kode', { length: 50 }),
    klasifikasiFasilitatif: text('klasifikasi_fasilitatif'),
    klasifikasiSubstantifKode: varchar('klasifikasi_substantif_kode', { length: 50 }),
    klasifikasiSubstantif: text('klasifikasi_substantif'),
    // File attachment fields
    filePath: text('file_path'),
    fileOriginalName: varchar('file_original_name', { length: 255 }),
    isArchived: boolean('is_archived').default(false),
    isDeleted: boolean('is_deleted').default(false),
    deletedAt: timestamp('deleted_at'),
    deletedBy: uuid('deleted_by').references(() => users.id),

    // Approval Workflow Fields
    approvalStatus: varchar('approval_status', { length: 50 }).default('draft').notNull(), // draft, pending, approved, rejected, signed
    currentApproverId: uuid('current_approver_id').references(() => users.id),

    // Digital Signature Fields
    isSigned: boolean('is_signed').default(false).notNull(),
    signedAt: timestamp('signed_at'),

    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const suratKeluarRelations = relations(suratKeluar, ({ one }) => ({
    unitKerja: one(unitKerja, {
        fields: [suratKeluar.unitKerjaId],
        references: [unitKerja.id],
    }),
    balasanSuratMasuk: one(suratMasuk, {
        fields: [suratKeluar.balasanUntuk],
        references: [suratMasuk.id],
    }),
    createdByUser: one(users, {
        fields: [suratKeluar.createdBy],
        references: [users.id],
    }),
    approvalRequest: one(approvalRequests, {
        fields: [suratKeluar.id],
        references: [approvalRequests.entityId],
    }),
    signature: one(digitalSignatures, {
        fields: [suratKeluar.id],
        references: [digitalSignatures.entityId],
    }),
}));

export type SuratKeluar = typeof suratKeluar.$inferSelect;
export type NewSuratKeluar = typeof suratKeluar.$inferInsert;
