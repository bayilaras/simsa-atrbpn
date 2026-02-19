import { pgTable, uuid, varchar, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { arsip } from './arsip';

/**
 * Layanan Arsip - Penggandaan dan Legalisasi
 */
export const layananArsip = pgTable('layanan_arsip', {
    id: uuid('id').primaryKey().defaultRandom(),
    jenisLayanan: varchar('jenis_layanan', { length: 30 }).notNull(), // 'penggandaan', 'legalisasi'
    arsipId: uuid('arsip_id').notNull().references(() => arsip.id),

    // Request Details
    jumlahRangkap: integer('jumlah_rangkap').default(1),
    keperluan: text('keperluan').notNull(),
    keterangan: text('keterangan'), // Additional notes from requester

    // Workflow
    status: varchar('status', { length: 20 }).default('diajukan').notNull(),
    // 'diajukan', 'diproses', 'selesai', 'ditolak'

    // Approval/Verification
    disetujuiOleh: uuid('disetujui_oleh').references(() => users.id),
    tanggalPersetujuan: timestamp('tanggal_persetujuan'),
    catatanPersetujuan: text('catatan_persetujuan'), // Rejection reason or approval notes

    // Tracking
    diajukanOleh: uuid('diajukan_oleh').notNull().references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const layananArsipRelations = relations(layananArsip, ({ one }) => ({
    arsip: one(arsip, {
        fields: [layananArsip.arsipId],
        references: [arsip.id],
    }),
    pemohon: one(users, {
        fields: [layananArsip.diajukanOleh],
        references: [users.id],
        relationName: 'pemohon',
    }),
    penyetuju: one(users, {
        fields: [layananArsip.disetujuiOleh],
        references: [users.id],
        relationName: 'penyetuju',
    }),
}));

export type LayananArsip = typeof layananArsip.$inferSelect;
export type NewLayananArsip = typeof layananArsip.$inferInsert;
