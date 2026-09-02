import { pgTable, uuid, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';
import { relations } from 'drizzle-orm';

export const notificationReads = pgTable('notification_reads', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    notificationId: varchar('notification_id', { length: 255 }).notNull(), // Composite ID: category-id
    readAt: timestamp('read_at').defaultNow().notNull(),
}, (table) => [
    uniqueIndex('notification_reads_user_notification_unique')
        .on(table.userId, table.notificationId),
]);

export const notificationReadsRelations = relations(notificationReads, ({ one }) => ({
    user: one(users, {
        fields: [notificationReads.userId],
        references: [users.id],
    }),
}));

export type NotificationRead = typeof notificationReads.$inferSelect;
export type NewNotificationRead = typeof notificationReads.$inferInsert;
