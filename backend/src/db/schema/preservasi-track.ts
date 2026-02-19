import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { arsipElektronik } from './arsip-elektronik';
import { users } from './users';

export const preservasiTrack = pgTable('preservasi_track', {
    id: uuid('id').primaryKey().defaultRandom(),
    arsipElektronikId: uuid('arsip_elektronik_id').notNull().references(() => arsipElektronik.id, { onDelete: 'cascade' }),
    action: varchar('action', { length: 50 }).notNull(), // 'migration', 'conversion', 'emulation', 'refreshing', 'backup'
    details: text('details'), // JSON string or text details
    performedBy: uuid('performed_by').references(() => users.id),
    performedAt: timestamp('performed_at').defaultNow().notNull(),
    notes: text('notes'),
});

export const preservasiTrackRelations = relations(preservasiTrack, ({ one }) => ({
    arsipElektronik: one(arsipElektronik, {
        fields: [preservasiTrack.arsipElektronikId],
        references: [arsipElektronik.id],
    }),
    user: one(users, {
        fields: [preservasiTrack.performedBy],
        references: [users.id],
    }),
}));

export type PreservasiTrack = typeof preservasiTrack.$inferSelect;
export type NewPreservasiTrack = typeof preservasiTrack.$inferInsert;
