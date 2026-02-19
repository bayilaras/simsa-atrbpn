import { pgTable, uuid, varchar, text, date, integer, timestamp } from 'drizzle-orm/pg-core';
import { arsip } from './arsip';
import { relations } from 'drizzle-orm';

export const arsipItems = pgTable('arsip_items', {
    id: uuid('id').primaryKey().defaultRandom(),
    arsipId: uuid('arsip_id').notNull().references(() => arsip.id, { onDelete: 'cascade' }),
    nomorItem: varchar('nomor_item', { length: 100 }),
    uraianItem: text('uraian_item'),
    tingkatPerkembangan: varchar('tingkat_perkembangan', { length: 50 }),
    tanggalItem: date('tanggal_item'),
    jumlah: integer('jumlah').default(1),
    mediaType: varchar('media_type', { length: 50 }).default('kertas'),
    lokasiFc: varchar('lokasi_fc', { length: 50 }),
    lokasiLaci: varchar('lokasi_laci', { length: 50 }),
    lokasiFolder: varchar('lokasi_folder', { length: 50 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const arsipItemsRelations = relations(arsipItems, ({ one }) => ({
    arsip: one(arsip, {
        fields: [arsipItems.arsipId],
        references: [arsip.id],
    }),
}));

export type ArsipItem = typeof arsipItems.$inferSelect;
export type NewArsipItem = typeof arsipItems.$inferInsert;
