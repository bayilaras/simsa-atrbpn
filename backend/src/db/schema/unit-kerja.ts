import { pgTable, varchar, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const unitKerja = pgTable('unit_kerja', {
    id: varchar('id', { length: 50 }).primaryKey(), // 'ditjen', 'sesditjen', 'dir_bppt', etc.
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    // Hierarchy fields
    parentId: varchar('parent_id', { length: 50 }), // References parent unit (e.g., 'ditjen' for direktorat)
    unitType: varchar('unit_type', { length: 30 }), // 'ditjen', 'sesditjen', 'direktorat', 'bagian'
    canReceiveDistribution: boolean('can_receive_distribution').default(true), // false for bagian_keuangan, bagian_kepegawaian
    // Google Drive integration
    driveFolderId: varchar('drive_folder_id', { length: 255 }),
    driveUploadFolderId: varchar('drive_upload_folder_id', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const unitKerjaRelations = relations(unitKerja, ({ one, many }) => ({
    parent: one(unitKerja, {
        fields: [unitKerja.parentId],
        references: [unitKerja.id],
        relationName: 'parentChild',
    }),
    children: many(unitKerja, {
        relationName: 'parentChild',
    }),
}));

export type UnitKerja = typeof unitKerja.$inferSelect;
export type NewUnitKerja = typeof unitKerja.$inferInsert;
