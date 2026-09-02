import { db } from '../config/database';
import { users, User } from '../db/schema/users';
import { unitKerja, UnitKerja } from '../db/schema/unit-kerja';
import { suratTemplates, userPreferences } from '../db/schema/settings';
import { eq } from 'drizzle-orm';
import { ValidationError } from '../utils/errors';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';

// Types
export interface ProfileUpdateData {
    name?: string;
    image?: string;
}

export interface UnitKerjaUpdateData {
    name?: string;
    description?: string;
    canReceiveDistribution?: boolean;
}

export interface SuratTemplate {
    unitKerjaId: string;
    masukFormat: string;  // e.g., "{noUrut}/SM-{unitKerja}/{tahun}"
    keluarFormat: string; // e.g., "{noUrut}/{naskahDinas}/{unitKerja}/{tahun}"
}

export interface SuratNumberData {
    noUrut: number;
    tahun: number;
    bulan?: number;
    unitKerja?: string;
    naskahDinas?: string;
}

export interface UserPreferenceValues {
    theme: 'light' | 'dark' | 'system';
    language: 'id' | 'en';
    notificationsEnabled: boolean;
    emailNotifications: boolean;
    updatedAt: Date | null;
}

export type UserPreferenceUpdate = Partial<Omit<UserPreferenceValues, 'updatedAt'>>;

export const DEFAULT_SURAT_TEMPLATE = (unitKerjaId: string): SuratTemplate => ({
    unitKerjaId,
    masukFormat: '{noUrut}/SM/{tahun}',
    keluarFormat: '{noUrut}/{naskahDinas}/{bulan}/{tahun}',
});

const DEFAULT_USER_PREFERENCES: UserPreferenceValues = {
    theme: 'light',
    language: 'id',
    notificationsEnabled: true,
    emailNotifications: false,
    updatedAt: null,
};

function toSuratTemplate(row: typeof suratTemplates.$inferSelect): SuratTemplate {
    return {
        unitKerjaId: row.unitKerjaId,
        masukFormat: row.masukFormat,
        keluarFormat: row.keluarFormat,
    };
}

function toUserPreferences(row: typeof userPreferences.$inferSelect): UserPreferenceValues {
    return {
        theme: row.theme as UserPreferenceValues['theme'],
        language: row.language as UserPreferenceValues['language'],
        notificationsEnabled: row.notificationsEnabled,
        emailNotifications: row.emailNotifications,
        updatedAt: row.updatedAt,
    };
}

const SUPPORTED_TEMPLATE_PLACEHOLDERS = new Set([
    '{noUrut}',
    '{tahun}',
    '{bulan}',
    '{unitKerja}',
    '{naskahDinas}',
]);

export function assertTemplateFormat(value: string, field: string): void {
    const normalized = value.trim();
    const placeholders = normalized.match(/\{[^{}]+\}/g) || [];
    const hasUnsupportedPlaceholder = placeholders.some(
        placeholder => !SUPPORTED_TEMPLATE_PLACEHOLDERS.has(placeholder),
    );
    const withoutSupportedPlaceholders = [...SUPPORTED_TEMPLATE_PLACEHOLDERS]
        .reduce((result, placeholder) => result.replaceAll(placeholder, ''), normalized);
    const hasUnmatchedBraces = /[{}]/.test(withoutSupportedPlaceholders);
    if (
        normalized.length < 3
        || normalized.length > 255
        || !normalized.includes('{noUrut}')
        || !normalized.includes('{tahun}')
        || /[\r\n\u0000-\u001f\u007f]/.test(normalized)
        || hasUnsupportedPlaceholder
        || hasUnmatchedBraces
    ) {
        throw new ValidationError(
            `${field} harus 3-255 karakter, memuat {noUrut} dan {tahun}, `
            + 'serta hanya memakai {bulan}, {unitKerja}, atau {naskahDinas} sebagai placeholder tambahan',
        );
    }
}

class SettingsService {
    // ==================== PROFILE SETTINGS ====================

    async getProfile(userId: string): Promise<User | null> {
        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        return user || null;
    }

    async updateProfile(
        userId: string,
        data: ProfileUpdateData,
        auditContext?: CriticalAuditContext,
    ): Promise<User | null> {
        return db.transaction(async (tx) => {
        const [before] = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for('update');
        if (!before) return null;
        const [updated] = await tx
            .update(users)
            .set({
                ...data,
                updatedAt: new Date(),
            })
            .where(eq(users.id, userId))
            .returning();

        if (updated && auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'update',
                entityType: 'user',
                entityId: userId,
                changes: { before, after: updated, fields: Object.keys(data) },
            }, tx);
        }
        return updated || null;
        });
    }

    // ==================== UNIT KERJA SETTINGS ====================

    async getUnitKerjaSettings(unitKerjaId: string): Promise<UnitKerja | null> {
        const [unit] = await db
            .select()
            .from(unitKerja)
            .where(eq(unitKerja.id, unitKerjaId))
            .limit(1);

        return unit || null;
    }

    async getAllUnitKerja(): Promise<UnitKerja[]> {
        const units = await db
            .select()
            .from(unitKerja)
            .orderBy(unitKerja.name);

        return units;
    }

    async updateUnitKerja(
        unitKerjaId: string,
        data: UnitKerjaUpdateData,
        auditContext?: CriticalAuditContext,
    ): Promise<UnitKerja | null> {
        return db.transaction(async (tx) => {
        const [before] = await tx.select().from(unitKerja)
            .where(eq(unitKerja.id, unitKerjaId)).limit(1).for('update');
        if (!before) return null;
        const [updated] = await tx
            .update(unitKerja)
            .set({
                ...data,
                updatedAt: new Date(),
            })
            .where(eq(unitKerja.id, unitKerjaId))
            .returning();

        if (updated && auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'update',
                entityType: 'unit_kerja',
                changes: { unitKerjaId, before, after: updated, fields: Object.keys(data) },
            }, tx);
        }
        return updated || null;
        });
    }

    async createUnitKerja(data: {
        id: string;
        name: string;
        description?: string;
        parentId?: string;
        unitType?: string;
    }, auditContext?: CriticalAuditContext): Promise<UnitKerja> {
        return db.transaction(async (tx) => {
        const [created] = await tx
            .insert(unitKerja)
            .values(data)
            .returning();

        if (auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'create',
                entityType: 'unit_kerja',
                changes: { unitKerjaId: created.id, after: created },
            }, tx);
        }
        return created;
        });
    }

    // ==================== SURAT TEMPLATES ====================
    async getSuratTemplates(unitKerjaId: string): Promise<SuratTemplate> {
        const [stored] = await db
            .select()
            .from(suratTemplates)
            .where(eq(suratTemplates.unitKerjaId, unitKerjaId))
            .limit(1);

        return stored ? toSuratTemplate(stored) : DEFAULT_SURAT_TEMPLATE(unitKerjaId);
    }

    /**
     * Create the durable default row if needed, then lock the unit template as
     * the transaction-scoped numbering mutex. This serializes even the first
     * letter of a unit/year, where locking a non-existent surat row cannot.
     */
    async lockSuratTemplates(executor: any, unitKerjaId: string): Promise<SuratTemplate> {
        const defaults = DEFAULT_SURAT_TEMPLATE(unitKerjaId);
        await executor.insert(suratTemplates).values(defaults).onConflictDoNothing({
            target: suratTemplates.unitKerjaId,
        });

        const [stored] = await executor
            .select()
            .from(suratTemplates)
            .where(eq(suratTemplates.unitKerjaId, unitKerjaId))
            .limit(1)
            .for('update');
        if (!stored) {
            throw new ValidationError('Template nomor surat unit kerja tidak dapat dikunci');
        }
        return toSuratTemplate(stored);
    }

    async updateSuratTemplates(
        unitKerjaId: string,
        templates: Partial<SuratTemplate>,
        auditContext?: CriticalAuditContext,
    ): Promise<SuratTemplate> {
        if (templates.masukFormat !== undefined) {
            assertTemplateFormat(templates.masukFormat, 'masukFormat');
        }
        if (templates.keluarFormat !== undefined) {
            assertTemplateFormat(templates.keluarFormat, 'keluarFormat');
        }
        const defaults = DEFAULT_SURAT_TEMPLATE(unitKerjaId);
        const now = new Date();
        const updates: Partial<typeof suratTemplates.$inferInsert> = { updatedAt: now };
        if (templates.masukFormat !== undefined) updates.masukFormat = templates.masukFormat.trim();
        if (templates.keluarFormat !== undefined) updates.keluarFormat = templates.keluarFormat.trim();

        return db.transaction(async (tx) => {
        const [before] = await tx.select().from(suratTemplates)
            .where(eq(suratTemplates.unitKerjaId, unitKerjaId)).limit(1).for('update');
        const [stored] = await tx.insert(suratTemplates).values({
            unitKerjaId,
            masukFormat: templates.masukFormat?.trim() || defaults.masukFormat,
            keluarFormat: templates.keluarFormat?.trim() || defaults.keluarFormat,
            updatedAt: now,
        }).onConflictDoUpdate({
            target: suratTemplates.unitKerjaId,
            set: updates,
        }).returning();

        if (auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: before ? 'update' : 'create',
                entityType: 'surat_template',
                changes: {
                    unitKerjaId,
                    before: before ? toSuratTemplate(before) : undefined,
                    after: toSuratTemplate(stored),
                    fields: Object.keys(templates),
                },
            }, tx);
        }
        return toSuratTemplate(stored);
        });
    }

    // Generate surat number based on template
    generateSuratNumber(template: string, data: SuratNumberData): string {
        assertTemplateFormat(template, 'template');
        let result = template;

        result = result.replaceAll('{noUrut}', String(data.noUrut).padStart(3, '0'));
        result = result.replaceAll('{tahun}', String(data.tahun));
        result = result.replaceAll('{bulan}', data.bulan ? String(data.bulan).padStart(2, '0') : '');
        result = result.replaceAll('{unitKerja}', data.unitKerja?.trim() || '');
        result = result.replaceAll('{naskahDinas}', data.naskahDinas?.trim() || '');

        // Clean up double slashes
        result = result.trim().replace(/\/+/g, '/').replace(/^\/|\/$/g, '');

        if (!result || result.length > 255) {
            throw new ValidationError('Hasil nomor surat harus berisi 1-255 karakter');
        }

        return result;
    }

    // ==================== APP PREFERENCES ====================
    async getUserPreferences(userId: string): Promise<UserPreferenceValues> {
        const [stored] = await db
            .select()
            .from(userPreferences)
            .where(eq(userPreferences.userId, userId))
            .limit(1);

        return stored ? toUserPreferences(stored) : { ...DEFAULT_USER_PREFERENCES };
    }

    async updateUserPreferences(
        userId: string,
        preferences: UserPreferenceUpdate,
        auditContext?: CriticalAuditContext,
    ): Promise<UserPreferenceValues> {
        const now = new Date();
        const updates: Partial<typeof userPreferences.$inferInsert> = { updatedAt: now };
        if (preferences.theme !== undefined) updates.theme = preferences.theme;
        if (preferences.language !== undefined) updates.language = preferences.language;
        if (preferences.notificationsEnabled !== undefined) {
            updates.notificationsEnabled = preferences.notificationsEnabled;
        }
        if (preferences.emailNotifications !== undefined) {
            updates.emailNotifications = preferences.emailNotifications;
        }

        return db.transaction(async (tx) => {
        const [before] = await tx.select().from(userPreferences)
            .where(eq(userPreferences.userId, userId)).limit(1).for('update');
        const [stored] = await tx.insert(userPreferences).values({
            userId,
            theme: preferences.theme ?? DEFAULT_USER_PREFERENCES.theme,
            language: preferences.language ?? DEFAULT_USER_PREFERENCES.language,
            notificationsEnabled: preferences.notificationsEnabled
                ?? DEFAULT_USER_PREFERENCES.notificationsEnabled,
            emailNotifications: preferences.emailNotifications
                ?? DEFAULT_USER_PREFERENCES.emailNotifications,
            updatedAt: now,
        }).onConflictDoUpdate({
            target: userPreferences.userId,
            set: updates,
        }).returning();

        if (auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: before ? 'update' : 'create',
                entityType: 'user_preferences',
                entityId: userId,
                changes: {
                    before: before ? toUserPreferences(before) : DEFAULT_USER_PREFERENCES,
                    after: toUserPreferences(stored),
                    fields: Object.keys(preferences),
                },
            }, tx);
        }
        return toUserPreferences(stored);
        });
    }
}

export const settingsService = new SettingsService();
