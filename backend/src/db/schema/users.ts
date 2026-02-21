import { pgTable, uuid, varchar, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { unitKerja } from './unit-kerja';

export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).unique().notNull(),
    name: varchar('name', { length: 255 }),
    image: text('image'),
    role: varchar('role', { length: 50 }).default('user').notNull(), // super_admin, admin_dirjen, admin_sesditjen, staff, user
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).references(() => unitKerja.id),
    jabatan: varchar('jabatan', { length: 100 }),  // Job title/position (e.g. 'Arsiparis')
    nip: varchar('nip', { length: 30 }),           // Nomor Induk Pegawai
    isActive: boolean('is_active').default(true).notNull(),
    emailVerified: boolean('email_verified').default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Better Auth required tables
export const sessions = pgTable('sessions', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: varchar('token', { length: 255 }).unique().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const accounts = pgTable('accounts', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    idToken: text('id_token'),
    password: text('password'), // Add password to accounts
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const verifications = pgTable('verifications', {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: varchar('identifier', { length: 255 }).notNull(),
    value: varchar('value', { length: 255 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
    accounts: many(accounts),
    sessions: many(sessions),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
    user: one(users, {
        fields: [accounts.userId],
        references: [users.id],
    }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
    user: one(users, {
        fields: [sessions.userId],
        references: [users.id],
    }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Account = typeof accounts.$inferSelect;
