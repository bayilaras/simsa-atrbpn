import { z } from 'zod';
import { ASSIGNABLE_ROLES, KNOWN_ROLES } from '../config/permissions.js';

// Valid roles
const roles = KNOWN_ROLES;

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
    password: z.string().min(8, 'Password minimal 8 karakter').optional(),
}).refine(value => value.role !== 'admin_unit' || Boolean(value.unitKerjaId?.trim()), {
    message: 'Unit kerja wajib untuk admin unit.', path: ['unitKerjaId'],
});

export type ListUsersQuery = z.infer<typeof listUsersSchema>;
export type UpdateUserBody = z.infer<typeof updateUserSchema>;
export type CreateUserBody = z.infer<typeof createUserSchema>;
