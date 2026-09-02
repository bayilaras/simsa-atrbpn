import { pgTable, uuid, varchar, text, timestamp, boolean, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
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
    // Firebase UID is an external identity reference, never the domain/user PK.
    // Keeping the UUID stable preserves every audit and foreign-key reference.
    firebaseUid: varchar('firebase_uid', { length: 128 }),
    identityProvider: varchar('identity_provider', { length: 24 }).default('better_auth').notNull(),
    authMigratedAt: timestamp('auth_migrated_at', { withTimezone: true }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
    uniqueIndex('users_firebase_uid_unique').on(table.firebaseUid),
    check(
        'users_identity_provider_check',
        sql`${table.identityProvider} in ('better_auth', 'firebase', 'hybrid')`,
    ),
    check(
        'users_firebase_identity_check',
        sql`${table.firebaseUid} is null or length(${table.firebaseUid}) between 1 and 128`,
    ),
    check('users_role_unit_mandate_check', sql`
        CASE ${table.role}
            WHEN 'super_admin' THEN ${table.unitKerjaId} IS NULL
            WHEN 'admin_dirjen' THEN ${table.unitKerjaId} IS NOT DISTINCT FROM 'ditjen'
            WHEN 'admin_sesditjen' THEN ${table.unitKerjaId} IS NOT DISTINCT FROM 'sesditjen'
            ELSE true
        END
    `),
]);

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
    issuer: text('issuer').notNull(),
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
}, (table) => [
    uniqueIndex('accounts_issuer_account_id_unique').on(table.issuer, table.accountId),
]);

export const verifications = pgTable('verifications', {
    id: uuid('id').primaryKey().defaultRandom(),
    // Better Auth stores a JSON blob here for social sign-in (PKCE codeVerifier,
    // callbackURL, expiry) that routinely exceeds 255 chars — must be text.
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
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
