import { pgTable, uuid, varchar, text, timestamp, integer, boolean } from 'drizzle-orm/pg-core';
import { users } from './users';
import { suratKeluar } from './surat-keluar';
import { relations } from 'drizzle-orm';

// Header workflow untuk sebuah entitas (surat keluar)
export const approvalRequests = pgTable('approval_requests', {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: varchar('entity_type', { length: 50 }).notNull(), // 'surat_keluar'
    entityId: uuid('entity_id').notNull().references(() => suratKeluar.id, { onDelete: 'cascade' }),
    currentStepOrder: integer('current_step_order').default(1).notNull(),
    status: varchar('status', { length: 50 }).default('pending').notNull(), // pending, approved, rejected, cancelled
    requesterId: uuid('requester_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Langkah-langkah dalam workflow
export const approvalSteps = pgTable('approval_steps', {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').notNull().references(() => approvalRequests.id, { onDelete: 'cascade' }),
    stepOrder: integer('step_order').notNull(),
    approverId: uuid('approver_id').references(() => users.id), // Specific user approver
    role: varchar('role', { length: 50 }), // Or any user with this role
    status: varchar('status', { length: 50 }).default('pending').notNull(), // pending, approved, rejected, skipped
    notes: text('notes'),
    actionAt: timestamp('action_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Log audit lengkap
export const approvalHistory = pgTable('approval_history', {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').notNull().references(() => approvalRequests.id, { onDelete: 'cascade' }),
    stepId: uuid('step_id').references(() => approvalSteps.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    action: varchar('action', { length: 50 }).notNull(), // APPROVE, REJECT, REQUEST_CHANGE, SUBMIT
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const approvalRelations = relations(approvalRequests, ({ one, many }) => ({
    steps: many(approvalSteps),
    history: many(approvalHistory),
    suratKeluar: one(suratKeluar, {
        fields: [approvalRequests.entityId],
        references: [suratKeluar.id],
    }),
    requester: one(users, {
        fields: [approvalRequests.requesterId],
        references: [users.id],
    }),
}));

export const approvalStepRelations = relations(approvalSteps, ({ one }) => ({
    request: one(approvalRequests, {
        fields: [approvalSteps.requestId],
        references: [approvalRequests.id],
    }),
    approver: one(users, {
        fields: [approvalSteps.approverId],
        references: [users.id],
    }),
}));
