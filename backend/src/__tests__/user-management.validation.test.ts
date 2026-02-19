import { describe, it, expect } from 'vitest';
import {
    listUsersSchema,
    updateUserSchema,
    userIdParamSchema,
} from '../validations/user-management.validation';

// ==================== listUsersSchema ====================

describe('listUsersSchema', () => {
    it('accepts empty query (all defaults)', () => {
        const result = listUsersSchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.page).toBe(1);
            expect(result.data.limit).toBe(20);
        }
    });

    it('accepts valid search and role filters', () => {
        const result = listUsersSchema.safeParse({
            search: 'test',
            role: 'super_admin',
        });
        expect(result.success).toBe(true);
    });

    it('rejects invalid role', () => {
        const result = listUsersSchema.safeParse({
            role: 'manager',
        });
        expect(result.success).toBe(false);
    });

    it('transforms isActive string to boolean', () => {
        const result = listUsersSchema.safeParse({ isActive: 'true' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.isActive).toBe(true);
        }
    });

    it('transforms page and limit strings to numbers', () => {
        const result = listUsersSchema.safeParse({ page: '3', limit: '10' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.page).toBe(3);
            expect(result.data.limit).toBe(10);
        }
    });

    it('accepts all valid roles', () => {
        for (const role of ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'user']) {
            const result = listUsersSchema.safeParse({ role });
            expect(result.success).toBe(true);
        }
    });
});

// ==================== updateUserSchema ====================

describe('updateUserSchema', () => {
    it('accepts empty body (all optional)', () => {
        const result = updateUserSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    it('accepts role update', () => {
        const result = updateUserSchema.safeParse({ role: 'admin_dirjen' });
        expect(result.success).toBe(true);
    });

    it('rejects invalid role', () => {
        const result = updateUserSchema.safeParse({ role: 'manager' });
        expect(result.success).toBe(false);
    });

    it('accepts null unitKerjaId (explicit removal)', () => {
        const result = updateUserSchema.safeParse({ unitKerjaId: null });
        expect(result.success).toBe(true);
    });

    it('accepts jabatan and nip fields', () => {
        const result = updateUserSchema.safeParse({
            jabatan: 'Arsiparis',
            nip: '198501012010011001',
        });
        expect(result.success).toBe(true);
    });

    it('accepts null jabatan and nip (clearing values)', () => {
        const result = updateUserSchema.safeParse({
            jabatan: null,
            nip: null,
        });
        expect(result.success).toBe(true);
    });

    it('rejects jabatan exceeding 100 characters', () => {
        const result = updateUserSchema.safeParse({
            jabatan: 'a'.repeat(101),
        });
        expect(result.success).toBe(false);
    });

    it('rejects nip exceeding 30 characters', () => {
        const result = updateUserSchema.safeParse({
            nip: '1'.repeat(31),
        });
        expect(result.success).toBe(false);
    });

    it('accepts isActive boolean', () => {
        const result = updateUserSchema.safeParse({ isActive: false });
        expect(result.success).toBe(true);
    });

    it('accepts all fields at once', () => {
        const result = updateUserSchema.safeParse({
            role: 'super_admin',
            unitKerjaId: 'ditjen',
            isActive: true,
            jabatan: 'Kepala Bagian Arsip',
            nip: '198501012010011001',
        });
        expect(result.success).toBe(true);
    });
});

// ==================== userIdParamSchema ====================

describe('userIdParamSchema', () => {
    it('accepts valid UUID', () => {
        const result = userIdParamSchema.safeParse({
            userId: '550e8400-e29b-41d4-a716-446655440000',
        });
        expect(result.success).toBe(true);
    });

    it('rejects non-UUID string', () => {
        const result = userIdParamSchema.safeParse({
            userId: 'not-a-uuid',
        });
        expect(result.success).toBe(false);
    });

    it('rejects missing userId', () => {
        const result = userIdParamSchema.safeParse({});
        expect(result.success).toBe(false);
    });
});
