import { pgTable, uuid, varchar, text, date, integer, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { arsip } from './arsip';
import { unitKerja } from './unit-kerja';
import { users } from './users';

/**
 * Penyusutan Arsip - Batch workflow for archival disposition
 * Tracks pemindahan (transfer), pemusnahan (destruction), penyerahan (submission)
 * Reference: Permen ATRBPN 2/2026, Lampiran II Angka 6
 */
export const penyusutanArsip = pgTable('penyusutan_arsip', {
    id: uuid('id').primaryKey().defaultRandom(),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).notNull().references(() => unitKerja.id),
    nomorBA: varchar('nomor_ba', { length: 100 }), // Nomor Berita Acara
    jenisPenyusutan: varchar('jenis_penyusutan', { length: 20 }).notNull(),
    // 'pemindahan' | 'pemusnahan' | 'penyerahan' | 'alih_media'
    status: varchar('status', { length: 20 }).default('draft').notNull(),
    // 'draft' | 'proposed' | 'reviewed' | 'approved' | 'executed'
    tanggalUsul: date('tanggal_usul'),
    tanggalReview: date('tanggal_review'),
    tanggalPersetujuan: date('tanggal_persetujuan'),
    tanggalPelaksanaan: date('tanggal_pelaksanaan'),
    catatanPanitia: text('catatan_panitia'),
    totalBerkas: integer('total_berkas').default(0),
    totalVolume: integer('total_volume').default(0),
    keterangan: text('keterangan'),
    createdBy: uuid('created_by').references(() => users.id),
    proposedBy: uuid('proposed_by').references(() => users.id),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    executedBy: uuid('executed_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Junction table linking arsip items to a penyusutan batch
 */
export const penyusutanItems = pgTable('penyusutan_items', {
    id: uuid('id').primaryKey().defaultRandom(),
    penyusutanId: uuid('penyusutan_id').notNull()
        .references(() => penyusutanArsip.id, { onDelete: 'cascade' }),
    arsipId: uuid('arsip_id').notNull()
        .references(() => arsip.id, { onDelete: 'restrict' }),
    nomorUrut: integer('nomor_urut'),
    keterangan: text('keterangan'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relations
export const penyusutanArsipRelations = relations(penyusutanArsip, ({ one, many }) => ({
    unitKerja: one(unitKerja, {
        fields: [penyusutanArsip.unitKerjaId],
        references: [unitKerja.id],
    }),
    createdByUser: one(users, {
        fields: [penyusutanArsip.createdBy],
        references: [users.id],
        relationName: 'penyusutanCreator',
    }),
    approvedByUser: one(users, {
        fields: [penyusutanArsip.approvedBy],
        references: [users.id],
        relationName: 'penyusutanApprover',
    }),
    proposedByUser: one(users, {
        fields: [penyusutanArsip.proposedBy],
        references: [users.id],
        relationName: 'penyusutanProposer',
    }),
    reviewedByUser: one(users, {
        fields: [penyusutanArsip.reviewedBy],
        references: [users.id],
        relationName: 'penyusutanReviewer',
    }),
    executedByUser: one(users, {
        fields: [penyusutanArsip.executedBy],
        references: [users.id],
        relationName: 'penyusutanExecutor',
    }),
    items: many(penyusutanItems),
}));

export const penyusutanItemsRelations = relations(penyusutanItems, ({ one }) => ({
    penyusutan: one(penyusutanArsip, {
        fields: [penyusutanItems.penyusutanId],
        references: [penyusutanArsip.id],
    }),
    arsip: one(arsip, {
        fields: [penyusutanItems.arsipId],
        references: [arsip.id],
    }),
}));

export type PenyusutanArsip = typeof penyusutanArsip.$inferSelect;
export type NewPenyusutanArsip = typeof penyusutanArsip.$inferInsert;
export type PenyusutanItem = typeof penyusutanItems.$inferSelect;
export type NewPenyusutanItem = typeof penyusutanItems.$inferInsert;
