import { describe, it, expect } from 'vitest';
import {
    listUsersSchema,
    updateUserSchema,
    userIdParamSchema,
    createUserSchema,
    resetPasswordSchema,
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
        const result = updateUserSchema.safeParse({ role: 'admin_unit' });
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

    it('carries the owner confirmation of the approval dialog', () => {
        const result = updateUserSchema.safeParse({ role: 'admin_unit', unitKerjaId: 'ditjen', ownerConfirmed: true });
        expect(result.success && result.data.ownerConfirmed).toBe(true);
        expect(updateUserSchema.safeParse({ ownerConfirmed: 'ya' }).success).toBe(false);
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

    it('lower-cases an upper-case UUID so it matches the stored id', () => {
        const result = userIdParamSchema.safeParse({
            userId: '550E8400-E29B-41D4-A716-446655440000',
        });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.userId).toBe('550e8400-e29b-41d4-a716-446655440000');
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
        role: 'super_admin' as const,
    };

    it('accepts valid user data without password', () => {
        const result = createUserSchema.safeParse(validUser);
        expect(result.success).toBe(true);
    });

    it('accepts valid user data with password', () => {
        const result = createUserSchema.safeParse({ ...validUser, password: 'SecurePass123!' });
        expect(result.success).toBe(true);
    });

    it('rejects a password shorter than 12 characters with an Indonesian message', () => {
        const result = createUserSchema.safeParse({ ...validUser, password: 'Pendek-11ch' });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues[0]).toMatchObject({ path: ['password'], message: 'Kata sandi minimal 12 karakter.' });
        expect(createUserSchema.safeParse({ ...validUser, password: 'Cukup-12-chr' }).success).toBe(true);
    });

    it('rejects a password containing the email local part, a name part, or a very common password', () => {
        const messageFor = (password: string, extra = {}) => {
            const result = createUserSchema.safeParse({ ...validUser, email: 'siti.rahma@example.com', name: 'Siti Rahmawati', ...extra, password });
            return result.success ? null : result.error.issues[0].message;
        };
        expect(messageFor('2026-Siti.Rahma-kantor')).toBe('Kata sandi tidak boleh memuat bagian depan alamat email (sebelum tanda @).');
        expect(messageFor('kantor-RAHMAWATI-2026')).toBe('Kata sandi tidak boleh memuat nama pengguna.');
        expect(messageFor('Password1234')).toBe('Kata sandi ini terlalu umum dan mudah ditebak. Pilih kata sandi lain.');
        expect(messageFor('lemari-arsip-biru-7')).toBeNull();
    });

    it('rejects a password Better Auth would refuse at sign-in (over 128 characters)', () => {
        expect(createUserSchema.safeParse({ ...validUser, password: 'a1'.repeat(64) }).success).toBe(true);
        expect(createUserSchema.safeParse({ ...validUser, password: 'a'.repeat(129) }).success).toBe(false);
    });

    it('rejects missing email', () => {
        const result = createUserSchema.safeParse({ name: 'Test', role: 'super_admin' });
        expect(result.success).toBe(false);
    });

    it('rejects invalid email format', () => {
        const result = createUserSchema.safeParse({ ...validUser, email: 'not-an-email' });
        expect(result.success).toBe(false);
    });

    it('rejects missing name', () => {
        const result = createUserSchema.safeParse({ email: 'test@x.com', role: 'super_admin' });
        expect(result.success).toBe(false);
    });

    it('rejects invalid role', () => {
        const result = createUserSchema.safeParse({ ...validUser, role: 'manager' });
        expect(result.success).toBe(false);
    });

    it('accepts only the canonical assignments with a unit for admin_unit', () => {
        for (const role of ['super_admin', 'admin_unit']) {
            const result = createUserSchema.safeParse({ ...validUser, role, unitKerjaId: 'ditjen' });
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

// ==================== resetPasswordSchema ====================

describe('resetPasswordSchema', () => {
    it('accepts 12 to 128 characters', () => {
        expect(resetPasswordSchema.safeParse({ newPassword: 'Cukup-12-chr' }).success).toBe(true);
        expect(resetPasswordSchema.safeParse({ newPassword: 'a1'.repeat(64) }).success).toBe(true);
    });

    it('rejects a missing, short, overlong or very common password with an Indonesian message', () => {
        expect(resetPasswordSchema.safeParse({}).success).toBe(false);
        const short = resetPasswordSchema.safeParse({ newPassword: '12345678901' });
        expect(short.success).toBe(false);
        if (!short.success) expect(short.error.issues[0].message).toBe('Kata sandi minimal 12 karakter.');
        const long = resetPasswordSchema.safeParse({ newPassword: 'a'.repeat(129) });
        expect(long.success).toBe(false);
        if (!long.success) expect(long.error.issues[0].message).toBe('Kata sandi maksimal 128 karakter.');
        const common = resetPasswordSchema.safeParse({ newPassword: 'Indonesia1945' });
        expect(common.success).toBe(false);
        if (!common.success) expect(common.error.issues[0].message).toBe('Kata sandi ini terlalu umum dan mudah ditebak. Pilih kata sandi lain.');
    });

    it('does not accept the password under another field name', () => {
        expect(resetPasswordSchema.safeParse({ password: 'synthetic-password' }).success).toBe(false);
    });
});
