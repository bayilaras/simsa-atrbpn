import { z } from 'zod';
import { ASSIGNABLE_ROLES, KNOWN_ROLES } from '../config/permissions.js';
import {
    CREDENTIAL_PASSWORD_MAX_LENGTH,
    CREDENTIAL_PASSWORD_MIN_LENGTH,
} from '../config/password-policy.js';

// Valid roles
const roles = KNOWN_ROLES;

// Same bounds as Better Auth's email+password sign-in (config/auth.ts).
const credentialPasswordSchema = z.string()
    .min(CREDENTIAL_PASSWORD_MIN_LENGTH, `Kata sandi minimal ${CREDENTIAL_PASSWORD_MIN_LENGTH} karakter`)
    .max(CREDENTIAL_PASSWORD_MAX_LENGTH, `Kata sandi maksimal ${CREDENTIAL_PASSWORD_MAX_LENGTH} karakter`);

// Query params for listing users
export const listUsersSchema = z.object({
    search: z.string().optional(),
    role: z.enum(roles).optional(),
    unitKerjaId: z.string().optional(),
    isActive: z.enum(['true', 'false']).optional().transform(val => val === 'true' ? true : val === 'false' ? false : undefined),
    page: z.string().optional().default('1').transform(Number),
    limit: z.string().optional().default('20').transform(Number),
});

// Update user body
export const updateUserSchema = z.object({
    role: z.enum(ASSIGNABLE_ROLES).optional(),
    unitKerjaId: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
    jabatan: z.string().max(100).nullable().optional(),
    nip: z.string().max(30).nullable().optional(),
});

// Params with userId
export const userIdParamSchema = z.object({
    userId: z.string().uuid(),
});

// Create user body
export const createUserSchema = z.object({
    email: z.string().email('Email tidak valid'),
    name: z.string().min(1, 'Nama wajib diisi').max(255),
    role: z.enum(ASSIGNABLE_ROLES),
    unitKerjaId: z.string().nullable().optional(),
    jabatan: z.string().max(100).nullable().optional(),
    nip: z.string().max(30).nullable().optional(),
    password: credentialPasswordSchema.optional(),
}).refine(value => value.role !== 'admin_unit' || Boolean(value.unitKerjaId?.trim()), {
    message: 'Unit kerja wajib untuk admin unit.', path: ['unitKerjaId'],
});

// Super Admin password reset body. `newPassword` is exempt from the HTML
// input sanitizer, so the stored hash matches what the user will type.
export const resetPasswordSchema = z.object({
    newPassword: credentialPasswordSchema,
});

export type ListUsersQuery = z.infer<typeof listUsersSchema>;
export type UpdateUserBody = z.infer<typeof updateUserSchema>;
export type CreateUserBody = z.infer<typeof createUserSchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>;
