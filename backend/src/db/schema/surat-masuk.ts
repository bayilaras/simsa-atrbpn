import { pgTable, uuid, varchar, text, date, boolean, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';
import { unitKerja } from './unit-kerja';
import { relations } from 'drizzle-orm';

export const suratMasuk = pgTable('surat_masuk', {
    id: uuid('id').primaryKey().defaultRandom(),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).notNull().references(() => unitKerja.id),
    noUrut: integer('no_urut').notNull(),
    tahun: integer('tahun').notNull(),
    jenisSurat: varchar('jenis_surat', { length: 100 }),
    sifatSurat: varchar('sifat_surat', { length: 50 }), // Biasa, Segera, Sangat Segera
    nomorSurat: varchar('nomor_surat', { length: 255 }),
    tanggalSurat: date('tanggal_surat'),
    perihal: text('perihal'),
    dari: text('dari'),
    kepada: text('kepada'),
    status: varchar('status', { length: 50 }).default('belum_dibalas'), // belum_dibalas, sudah_dibalas
    disposisi: text('disposisi').array(),
    keterangan: text('keterangan'),
    // File attachment fields
    linkDokumen: text('link_dokumen'),
    filePath: text('file_path'),
    fileOriginalName: varchar('file_original_name', { length: 255 }),
    // Klasifikasi fields
    klasifikasiKode: varchar('klasifikasi_kode', { length: 50 }),
    klasifikasiUraian: text('klasifikasi_uraian'),
    isArchived: boolean('is_archived').default(false),
    isDeleted: boolean('is_deleted').default(false),
    deletedAt: timestamp('deleted_at'),
    deletedBy: uuid('deleted_by').references(() => users.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const suratMasukRelations = relations(suratMasuk, ({ one, many }) => ({
    unitKerja: one(unitKerja, {
        fields: [suratMasuk.unitKerjaId],
        references: [unitKerja.id],
    }),
    createdByUser: one(users, {
        fields: [suratMasuk.createdBy],
        references: [users.id],
    }),
}));

export type SuratMasuk = typeof suratMasuk.$inferSelect;
export type NewSuratMasuk = typeof suratMasuk.$inferInsert;
