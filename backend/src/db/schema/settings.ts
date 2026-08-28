import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { unitKerja } from './unit-kerja';
import { users } from './users';

/** Durable, bounded user preferences shared by every application instance. */
export const userPreferences = pgTable('user_preferences', {
    userId: uuid('user_id').primaryKey()
        .references(() => users.id, { onDelete: 'cascade' }),
    theme: varchar('theme', { length: 20 }).notNull().default('light'),
    language: varchar('language', { length: 10 }).notNull().default('id'),
    notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
    emailNotifications: boolean('email_notifications').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    check(
        'user_preferences_theme_check',
        sql`${table.theme} in ('light', 'dark', 'system')`,
    ),
    check(
        'user_preferences_language_check',
        sql`${table.language} in ('id', 'en')`,
    ),
]);

/** Numbering formats are unit-owned configuration, not process-local state. */
export const suratTemplates = pgTable('surat_templates', {
    unitKerjaId: varchar('unit_kerja_id', { length: 50 }).primaryKey()
        .references(() => unitKerja.id, { onDelete: 'cascade' }),
    masukFormat: varchar('masuk_format', { length: 255 }).notNull()
        .default('{noUrut}/SM/{tahun}'),
    keluarFormat: varchar('keluar_format', { length: 255 }).notNull()
        .default('{noUrut}/{naskahDinas}/{bulan}/{tahun}'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    check(
        'surat_templates_masuk_format_check',
        sql`length(trim(${table.masukFormat})) between 3 and 255
            and position('{noUrut}' in ${table.masukFormat}) > 0
            and position('{tahun}' in ${table.masukFormat}) > 0`,
    ),
    check(
        'surat_templates_keluar_format_check',
        sql`length(trim(${table.keluarFormat})) between 3 and 255
            and position('{noUrut}' in ${table.keluarFormat}) > 0
            and position('{tahun}' in ${table.keluarFormat}) > 0`,
    ),
    check(
        'surat_templates_masuk_placeholder_check',
        sql`${table.masukFormat} !~ '[[:cntrl:]]'
            and position('{' in replace(replace(replace(replace(replace(
                ${table.masukFormat}, '{noUrut}', ''), '{tahun}', ''), '{bulan}', ''),
                '{unitKerja}', ''), '{naskahDinas}', '')) = 0
            and position('}' in replace(replace(replace(replace(replace(
                ${table.masukFormat}, '{noUrut}', ''), '{tahun}', ''), '{bulan}', ''),
                '{unitKerja}', ''), '{naskahDinas}', '')) = 0`,
    ),
    check(
        'surat_templates_keluar_placeholder_check',
        sql`${table.keluarFormat} !~ '[[:cntrl:]]'
            and position('{' in replace(replace(replace(replace(replace(
                ${table.keluarFormat}, '{noUrut}', ''), '{tahun}', ''), '{bulan}', ''),
                '{unitKerja}', ''), '{naskahDinas}', '')) = 0
            and position('}' in replace(replace(replace(replace(replace(
                ${table.keluarFormat}, '{noUrut}', ''), '{tahun}', ''), '{bulan}', ''),
                '{unitKerja}', ''), '{naskahDinas}', '')) = 0`,
    ),
]);

export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;
export type SuratTemplateSettings = typeof suratTemplates.$inferSelect;
