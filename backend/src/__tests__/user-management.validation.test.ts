import { describe, it, expect } from 'vitest';
import {
    listUsersSchema,
    updateUserSchema,
    userIdParamSchema,
    createUserSchema,
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
        for (const role of ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'staff', 'user']) {
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

// ==================== createUserSchema ====================

describe('createUserSchema', () => {
    const validUser = {
        email: 'test@example.com',
        name: 'Test User',
        role: 'user' as const,
    };

    it('accepts valid user data without password', () => {
        const result = createUserSchema.safeParse(validUser);
        expect(result.success).toBe(true);
    });

    it('accepts valid user data with password', () => {
        const result = createUserSchema.safeParse({ ...validUser, password: 'SecurePass123!' });
        expect(result.success).toBe(true);
    });

    it('rejects password shorter than 8 characters', () => {
        const result = createUserSchema.safeParse({ ...validUser, password: 'short' });
        expect(result.success).toBe(false);
    });

    it('accepts password exactly 8 characters', () => {
        const result = createUserSchema.safeParse({ ...validUser, password: '12345678' });
        expect(result.success).toBe(true);
    });

    it('rejects missing email', () => {
        const result = createUserSchema.safeParse({ name: 'Test', role: 'user' });
        expect(result.success).toBe(false);
    });

    it('rejects invalid email format', () => {
        const result = createUserSchema.safeParse({ ...validUser, email: 'not-an-email' });
        expect(result.success).toBe(false);
    });

    it('rejects missing name', () => {
        const result = createUserSchema.safeParse({ email: 'test@x.com', role: 'user' });
        expect(result.success).toBe(false);
    });

    it('rejects invalid role', () => {
        const result = createUserSchema.safeParse({ ...validUser, role: 'manager' });
        expect(result.success).toBe(false);
    });

    it('accepts all valid roles including unit-scoped auditor', () => {
        for (const role of ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor', 'user']) {
            const result = createUserSchema.safeParse({ ...validUser, role });
            expect(result.success).toBe(true);
        }
    });

    it('accepts optional fields', () => {
        const result = createUserSchema.safeParse({
            ...validUser,
            unitKerjaId: 'ditjen',
            jabatan: 'Arsiparis',
            nip: '198501012010011001',
            password: 'StrongPass1!',
        });
        expect(result.success).toBe(true);
    });

    it('accepts null unitKerjaId', () => {
        const result = createUserSchema.safeParse({ ...validUser, unitKerjaId: null });
        expect(result.success).toBe(true);
    });

    it('rejects jabatan exceeding 100 characters', () => {
        const result = createUserSchema.safeParse({ ...validUser, jabatan: 'a'.repeat(101) });
        expect(result.success).toBe(false);
    });

    it('rejects nip exceeding 30 characters', () => {
        const result = createUserSchema.safeParse({ ...validUser, nip: '1'.repeat(31) });
        expect(result.success).toBe(false);
    });
});
