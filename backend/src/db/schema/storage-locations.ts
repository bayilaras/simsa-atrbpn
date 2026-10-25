import { pgTable, uuid, varchar, text, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { unitKerja } from './unit-kerja';
import { relations, sql } from 'drizzle-orm';

/**
 * Storage Locations - Hierarchical storage structure
 * Levels: gedung -> ruang -> rak -> box
 */
export const storageLocations = pgTable('storage_locations', {
    id: uuid('id').primaryKey().defaultRandom(),
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).notNull().references(() => unitKerja.id),
    code: varchar('code', { length: 50 }).notNull(), // e.g., "G1-R2-RAK3-B15"
    name: varchar('name', { length: 255 }).notNull(), // e.g., "Box 15"
    level: varchar('level', { length: 20 }).notNull(), // 'gedung', 'ruang', 'rak', 'box'
    parentId: uuid('parent_id'), // Self-referencing for hierarchy
    description: text('description'),
    capacity: integer('capacity'), // Max items for box level
    currentCount: integer('current_count').default(0), // Current arsip items in this location
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
    uniqueIndex('storage_locations_unit_code_unique_idx')
        .on(table.unitKerjaId, sql`lower(btrim(${table.code}))`),
]);

export const storageLocationsRelations = relations(storageLocations, ({ one, many }) => ({
    unitKerja: one(unitKerja, {
        fields: [storageLocations.unitKerjaId],
        references: [unitKerja.id],
    }),
    parent: one(storageLocations, {
        fields: [storageLocations.parentId],
        references: [storageLocations.id],
        relationName: 'parentChild',
    }),
    children: many(storageLocations, {
        relationName: 'parentChild',
    }),
}));

export type StorageLocation = typeof storageLocations.$inferSelect;
export type NewStorageLocation = typeof storageLocations.$inferInsert;
