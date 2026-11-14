import { z } from 'zod';
import { ASSIGNABLE_ROLES, KNOWN_ROLES } from '../config/permissions.js';
import { newPasswordProblem } from '../config/password-policy.js';

// Valid roles
const roles = KNOWN_ROLES;

// A password a Super Admin sets must follow the rules for new passwords
// (config/password-policy.ts). The message never echoes the value.
function refuseWeakPassword(password: string, owner: { email?: string; name?: string }, ctx: z.RefinementCtx, path: string[]) {
    const problem = newPasswordProblem(password, owner);
    if (problem) ctx.addIssue({ code: 'custom', message: problem, path });
}

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

// Params with userId. uuid() also accepts upper-case hex; Postgres returns
// ids in lower case, and the self checks and accounts.account_id (text)
// compare the string as written.
export const userIdParamSchema = z.object({
    userId: z.string().uuid().transform(value => value.toLowerCase()),
});

// Create user body
export const createUserSchema = z.object({
    email: z.string().email('Email tidak valid'),
    name: z.string().min(1, 'Nama wajib diisi').max(255),
    role: z.enum(ASSIGNABLE_ROLES),
    unitKerjaId: z.string().nullable().optional(),
    jabatan: z.string().max(100).nullable().optional(),
    nip: z.string().max(30).nullable().optional(),
    password: z.string().optional(),
}).refine(value => value.role !== 'admin_unit' || Boolean(value.unitKerjaId?.trim()), {
    message: 'Unit kerja wajib untuk admin unit.', path: ['unitKerjaId'],
}).superRefine((value, ctx) => {
    if (value.password !== undefined) refuseWeakPassword(value.password, value, ctx, ['password']);
});

// Super Admin password reset body. `newPassword` is exempt from the HTML
// input sanitizer, so the stored hash matches what the user will type. The
// service repeats the check against the target's email and name.
export const resetPasswordSchema = z.object({
    newPassword: z.string(),
}).superRefine((value, ctx) => refuseWeakPassword(value.newPassword, {}, ctx, ['newPassword']));

export type ListUsersQuery = z.infer<typeof listUsersSchema>;
export type UpdateUserBody = z.infer<typeof updateUserSchema>;
export type CreateUserBody = z.infer<typeof createUserSchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>;
