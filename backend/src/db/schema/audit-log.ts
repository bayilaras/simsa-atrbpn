import { pgTable, uuid, varchar, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { users } from './users';

export const auditLog = pgTable('audit_log', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id),
    userEmail: varchar('user_email', { length: 255 }),
    action: varchar('action', { length: 50 }).notNull(), // create, update, delete, archive
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: uuid('entity_id'),
    changes: jsonb('changes'),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
