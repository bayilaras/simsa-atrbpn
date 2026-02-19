import { pgTable, uuid, varchar, text, date, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';
import { arsip } from './arsip';
import { storageLocations } from './storage-locations';
import { relations } from 'drizzle-orm';

/**
 * Archive Lending - Track borrowing of physical archives
 * Supports both per-arsip and per-box lending
 */
export const archiveLending = pgTable('archive_lending', {
    id: uuid('id').primaryKey().defaultRandom(),
    lendingType: varchar('lending_type', { length: 20 }).notNull(), // 'arsip' or 'box'
    arsipId: uuid('arsip_id').references(() => arsip.id), // for per-arsip lending
    storageLocationId: uuid('storage_location_id').references(() => storageLocations.id), // for per-box lending
    borrowerId: uuid('borrower_id').notNull().references(() => users.id),
    borrowerName: varchar('borrower_name', { length: 255 }).notNull(),
    departmentUnit: varchar('department_unit', { length: 255 }),
    borrowDate: date('borrow_date').notNull(),
    dueDate: date('due_date').notNull(),
    returnDate: date('return_date'), // null if not returned
    status: varchar('status', { length: 20 }).default('borrowed').notNull(), // borrowed, returned, overdue
    purpose: text('purpose'),
    notes: text('notes'),
    approvedBy: uuid('approved_by').references(() => users.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const archiveLendingRelations = relations(archiveLending, ({ one }) => ({
    arsip: one(arsip, {
        fields: [archiveLending.arsipId],
        references: [arsip.id],
    }),
    storageLocation: one(storageLocations, {
        fields: [archiveLending.storageLocationId],
        references: [storageLocations.id],
    }),
    borrower: one(users, {
        fields: [archiveLending.borrowerId],
        references: [users.id],
        relationName: 'borrower',
    }),
    approver: one(users, {
        fields: [archiveLending.approvedBy],
        references: [users.id],
        relationName: 'approver',
    }),
    createdByUser: one(users, {
        fields: [archiveLending.createdBy],
        references: [users.id],
        relationName: 'creator',
    }),
}));

export type ArchiveLending = typeof archiveLending.$inferSelect;
export type NewArchiveLending = typeof archiveLending.$inferInsert;
