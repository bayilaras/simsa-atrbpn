import { pgTable, uuid, varchar, text, timestamp, boolean, integer } from 'drizzle-orm/pg-core';
import { users } from './users';
import { suratKeluar } from './surat-keluar';
import { relations } from 'drizzle-orm';

export const digitalSignatures = pgTable('digital_signatures', {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: varchar('entity_type', { length: 50 }).notNull(), // 'surat_keluar'
    entityId: uuid('entity_id').notNull().references(() => suratKeluar.id, { onDelete: 'cascade' }),

    signerId: uuid('signer_id').notNull().references(() => users.id),
    certificateId: varchar('certificate_id', { length: 255 }), // ID Sertifikat Elektronik

    signedAt: timestamp('signed_at').defaultNow().notNull(),

    // Metadata untuk validasi visual
    qrCodeContent: text('qr_code_content'),
    visualPage: integer('visual_page'),
    visualX: integer('visual_x'),
    visualY: integer('visual_y'),

    // Cryptographic proof (stub/simulation)
    documentHash: varchar('document_hash', { length: 255 }),
    signatureValue: text('signature_value'),

    isValid: boolean('is_valid').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const digitalSignatureRelations = relations(digitalSignatures, ({ one }) => ({
    signer: one(users, {
        fields: [digitalSignatures.signerId],
        references: [users.id],
    }),
    suratKeluar: one(suratKeluar, {
        fields: [digitalSignatures.entityId],
        references: [suratKeluar.id],
    }),
}));
