import { db } from '../config/database';
import { users, User } from '../db/schema/users';
import { unitKerja, UnitKerja } from '../db/schema/unit-kerja';
import { eq } from 'drizzle-orm';

// Types
export interface ProfileUpdateData {
    name?: string;
    image?: string;
}

export interface UnitKerjaUpdateData {
    name?: string;
    description?: string;
    driveFolderId?: string;
    driveUploadFolderId?: string;
    canReceiveDistribution?: boolean;
}

export interface SuratTemplate {
    unitKerjaId: string;
    masukFormat: string;  // e.g., "{noUrut}/SM-{unitKerja}/{tahun}"
    keluarFormat: string; // e.g., "{noUrut}/{naskahDinas}/{unitKerja}/{tahun}"
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

    async updateProfile(userId: string, data: ProfileUpdateData): Promise<User | null> {
        const [updated] = await db
            .update(users)
            .set({
                ...data,
                updatedAt: new Date(),
            })
            .where(eq(users.id, userId))
            .returning();

        return updated || null;
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

    async updateUnitKerja(unitKerjaId: string, data: UnitKerjaUpdateData): Promise<UnitKerja | null> {
        const [updated] = await db
            .update(unitKerja)
            .set({
                ...data,
                updatedAt: new Date(),
            })
            .where(eq(unitKerja.id, unitKerjaId))
            .returning();

        return updated || null;
    }

    async createUnitKerja(data: {
        id: string;
        name: string;
        description?: string;
        parentId?: string;
        unitType?: string;
        driveFolderId?: string;
        driveUploadFolderId?: string;
    }): Promise<UnitKerja> {
        const [created] = await db
            .insert(unitKerja)
            .values(data)
            .returning();

        return created;
    }

    // ==================== SURAT TEMPLATES ====================
    // Note: Templates are stored as a simple JSON config
    // In a full implementation, this could be a separate table

    private suratTemplates: Map<string, SuratTemplate> = new Map();

    async getSuratTemplates(unitKerjaId: string): Promise<SuratTemplate> {
        // Default templates
        const defaultTemplate: SuratTemplate = {
            unitKerjaId,
            masukFormat: '{noUrut}/SM/{tahun}',
            keluarFormat: '{noUrut}/{naskahDinas}/{bulan}/{tahun}',
        };

        return this.suratTemplates.get(unitKerjaId) || defaultTemplate;
    }

    async updateSuratTemplates(unitKerjaId: string, templates: Partial<SuratTemplate>): Promise<SuratTemplate> {
        const existing = await this.getSuratTemplates(unitKerjaId);
        const updated = { ...existing, ...templates, unitKerjaId };
        this.suratTemplates.set(unitKerjaId, updated);
        return updated;
    }

    // Generate surat number based on template
    generateSuratNumber(template: string, data: {
        noUrut: number;
        tahun: number;
        bulan?: number;
        unitKerja?: string;
        naskahDinas?: string;
    }): string {
        let result = template;

        result = result.replace('{noUrut}', String(data.noUrut).padStart(3, '0'));
        result = result.replace('{tahun}', String(data.tahun));
        result = result.replace('{bulan}', data.bulan ? String(data.bulan).padStart(2, '0') : '');
        result = result.replace('{unitKerja}', data.unitKerja || '');
        result = result.replace('{naskahDinas}', data.naskahDinas || '');

        // Clean up double slashes
        result = result.replace(/\/+/g, '/').replace(/\/$/, '');

        return result;
    }

    // ==================== APP PREFERENCES ====================
    // User preferences stored in a simple key-value style

    private userPreferences: Map<string, Record<string, any>> = new Map();

    async getUserPreferences(userId: string): Promise<Record<string, any>> {
        return this.userPreferences.get(userId) || {
            theme: 'light',
            language: 'id',
            notificationsEnabled: true,
            emailNotifications: false,
        };
    }

    async updateUserPreferences(userId: string, preferences: Record<string, any>): Promise<Record<string, any>> {
        const existing = await this.getUserPreferences(userId);
        const updated = { ...existing, ...preferences };
        this.userPreferences.set(userId, updated);
        return updated;
    }
}

export const settingsService = new SettingsService();
