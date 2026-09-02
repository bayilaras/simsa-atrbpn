import { z } from 'zod';

// Valid roles
const roles = ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor', 'user'] as const;

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
    role: z.enum(roles).optional(),
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
    role: z.enum(roles),
    unitKerjaId: z.string().nullable().optional(),
    jabatan: z.string().max(100).nullable().optional(),
    nip: z.string().max(30).nullable().optional(),
    password: z.string().min(8, 'Password minimal 8 karakter').optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersSchema>;
export type UpdateUserBody = z.infer<typeof updateUserSchema>;
export type CreateUserBody = z.infer<typeof createUserSchema>;
