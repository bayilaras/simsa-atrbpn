import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { suratMasuk } from './surat-masuk';
import { unitKerja } from './unit-kerja';
import { users } from './users';
import { relations } from 'drizzle-orm';

/**
 * Surat Distribution - tracks mail routing from Ditjen to Direktorat/Sesditjen
 */
export const suratDistributions = pgTable('surat_distributions', {
    id: uuid('id').primaryKey().defaultRandom(),
    suratMasukId: uuid('surat_masuk_id').notNull().references(() => suratMasuk.id),
    sourceUnitId: varchar('source_unit_id', { length: 50 }).notNull().references(() => unitKerja.id),
    targetUnitId: varchar('target_unit_id', { length: 50 }).notNull().references(() => unitKerja.id),
    ccUnits: text('cc_units'), // JSON array of unit IDs for tembusan (info only)
    instruction: text('instruction'), // e.g., "Mohon tindak lanjut"
    status: varchar('status', { length: 20 }).notNull().default('sent'), // sent, received, processed, rejected
    rejectionReason: text('rejection_reason'),
    sentAt: timestamp('sent_at').defaultNow().notNull(),
    receivedAt: timestamp('received_at'),
    processedAt: timestamp('processed_at'),
    sentBy: uuid('sent_by').references(() => users.id),
    receivedBy: uuid('received_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const suratDistributionsRelations = relations(suratDistributions, ({ one }) => ({
    suratMasuk: one(suratMasuk, {
        fields: [suratDistributions.suratMasukId],
        references: [suratMasuk.id],
    }),
    sourceUnit: one(unitKerja, {
        fields: [suratDistributions.sourceUnitId],
        references: [unitKerja.id],
        relationName: 'sourceUnit',
    }),
    targetUnit: one(unitKerja, {
        fields: [suratDistributions.targetUnitId],
        references: [unitKerja.id],
        relationName: 'targetUnit',
    }),
    sentByUser: one(users, {
        fields: [suratDistributions.sentBy],
        references: [users.id],
        relationName: 'sentByUser',
    }),
    receivedByUser: one(users, {
        fields: [suratDistributions.receivedBy],
        references: [users.id],
        relationName: 'receivedByUser',
    }),
}));

export type SuratDistribution = typeof suratDistributions.$inferSelect;
export type NewSuratDistribution = typeof suratDistributions.$inferInsert;
