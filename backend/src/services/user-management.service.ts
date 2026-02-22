import { db } from '../config/database';
import { users, unitKerja } from '../db/schema';
import { eq, ilike, or, and, desc, sql } from 'drizzle-orm';
import { auth } from '../config/auth';

export interface UserFilters {
    search?: string;
    role?: string;
    unitKerjaId?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
}

export interface UpdateUserData {
    role?: string;
    unitKerjaId?: string | null;
    isActive?: boolean;
    jabatan?: string | null;
    nip?: string | null;
}

export interface CreateUserData {
    email: string;
    name: string;
    role: string;
    unitKerjaId?: string | null;
    jabatan?: string | null;
    nip?: string | null;
    password?: string;
}

// Valid roles
export const VALID_ROLES = ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'staff', 'user'] as const;
export type Role = typeof VALID_ROLES[number];

// Admin roles that can access user management
export const ADMIN_ROLES: Role[] = ['super_admin'];

export const userManagementService = {
    /**
     * Create a new user (by Super Admin)
     */
    async createUser(data: CreateUserData) {
        // Validate role
        if (!VALID_ROLES.includes(data.role as Role)) {
            throw new Error(`Invalid role: ${data.role}`);
        }

        // Check if email already exists
        const [existingUser] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, data.email))
            .limit(1);

        if (existingUser) {
            throw new Error('Email sudah terdaftar');
        }

        // Validate unit kerja if provided
        if (data.unitKerjaId) {
            const [unit] = await db
                .select({ id: unitKerja.id })
                .from(unitKerja)
                .where(eq(unitKerja.id, data.unitKerjaId))
                .limit(1);

            if (!unit) {
                throw new Error(`Invalid unitKerjaId: ${data.unitKerjaId}`);
            }
        }

        let userId: string;

        if (data.password) {
            // Use Better Auth signup API to create user with email/password credentials
            // This creates both the user record AND the account (with hashed password)
            const signupResult = await auth.api.signUpEmail({
                body: {
                    email: data.email,
                    password: data.password,
                    name: data.name,
                },
            });

            if (!signupResult?.user?.id) {
                throw new Error('Failed to create user with Better Auth');
            }

            userId = signupResult.user.id;

            // Update additional fields that Better Auth doesn't handle
            await db
                .update(users)
                .set({
                    role: data.role,
                    unitKerjaId: data.unitKerjaId || null,
                    jabatan: data.jabatan || null,
                    nip: data.nip || null,
                    isActive: true,
                    emailVerified: true, // Admin-created, auto-verified
                })
                .where(eq(users.id, userId));
        } else {
            // No password — user will login via Google OAuth only
            const [newUser] = await db
                .insert(users)
                .values({
                    email: data.email,
                    name: data.name,
                    role: data.role,
                    unitKerjaId: data.unitKerjaId || null,
                    jabatan: data.jabatan || null,
                    nip: data.nip || null,
                    isActive: true,
                    emailVerified: false,
                })
                .returning();

            if (!newUser) {
                throw new Error('Failed to create user');
            }

            userId = newUser.id;
        }

        return this.getUserById(userId);
    },

    /**
     * List users with filters and pagination
     */
    async listUsers(filters: UserFilters = {}) {
        const { search, role, unitKerjaId, isActive, page = 1, limit = 20 } = filters;
        const offset = (page - 1) * limit;

        // Build where conditions
        const conditions = [];

        if (search) {
            conditions.push(
                or(
                    ilike(users.name, `%${search}%`),
                    ilike(users.email, `%${search}%`)
                )
            );
        }

        if (role) {
            conditions.push(eq(users.role, role));
        }

        if (unitKerjaId) {
            conditions.push(eq(users.unitKerjaId, unitKerjaId));
        }

        if (isActive !== undefined) {
            conditions.push(eq(users.isActive, isActive));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        // Get total count
        const [{ count }] = await db
            .select({ count: sql<number>`count(*)` })
            .from(users)
            .where(whereClause);

        // Get users with unit kerja info
        const userList = await db
            .select({
                id: users.id,
                email: users.email,
                name: users.name,
                image: users.image,
                role: users.role,
                unitKerjaId: users.unitKerjaId,
                unitKerjaName: unitKerja.name,
                jabatan: users.jabatan,
                nip: users.nip,
                isActive: users.isActive,
                createdAt: users.createdAt,
                updatedAt: users.updatedAt,
            })
            .from(users)
            .leftJoin(unitKerja, eq(users.unitKerjaId, unitKerja.id))
            .where(whereClause)
            .orderBy(desc(users.createdAt))
            .limit(limit)
            .offset(offset);

        return {
            data: userList,
            pagination: {
                page,
                limit,
                total: Number(count),
                totalPages: Math.ceil(Number(count) / limit),
            },
        };
    },

    /**
     * Get single user by ID
     */
    async getUserById(userId: string) {
        const [user] = await db
            .select({
                id: users.id,
                email: users.email,
                name: users.name,
                image: users.image,
                role: users.role,
                unitKerjaId: users.unitKerjaId,
                unitKerjaName: unitKerja.name,
                jabatan: users.jabatan,
                nip: users.nip,
                isActive: users.isActive,
                emailVerified: users.emailVerified,
                createdAt: users.createdAt,
                updatedAt: users.updatedAt,
            })
            .from(users)
            .leftJoin(unitKerja, eq(users.unitKerjaId, unitKerja.id))
            .where(eq(users.id, userId))
            .limit(1);

        return user || null;
    },

    /**
     * Update user (role, unitKerja, isActive)
     */
    async updateUser(userId: string, data: UpdateUserData) {
        // Validate role if provided
        if (data.role && !VALID_ROLES.includes(data.role as Role)) {
            throw new Error(`Invalid role: ${data.role}`);
        }

        // Validate unit kerja if provided
        if (data.unitKerjaId) {
            const [unit] = await db
                .select({ id: unitKerja.id })
                .from(unitKerja)
                .where(eq(unitKerja.id, data.unitKerjaId))
                .limit(1);

            if (!unit) {
                throw new Error(`Invalid unitKerjaId: ${data.unitKerjaId}`);
            }
        }

        const updateData: any = {
            updatedAt: new Date(),
        };

        if (data.role !== undefined) updateData.role = data.role;
        if (data.unitKerjaId !== undefined) updateData.unitKerjaId = data.unitKerjaId;
        if (data.isActive !== undefined) updateData.isActive = data.isActive;
        if (data.jabatan !== undefined) updateData.jabatan = data.jabatan;
        if (data.nip !== undefined) updateData.nip = data.nip;

        const [updatedUser] = await db
            .update(users)
            .set(updateData)
            .where(eq(users.id, userId))
            .returning();

        if (!updatedUser) {
            return null;
        }

        // Return with unit kerja info
        return this.getUserById(userId);
    },

    /**
     * Deactivate user (soft delete)
     */
    async deactivateUser(userId: string) {
        return this.updateUser(userId, { isActive: false });
    },

    /**
     * Get available roles
     */
    getRoles() {
        return VALID_ROLES.map(role => ({
            value: role,
            label: this.getRoleLabel(role),
        }));
    },

    /**
     * Get human-readable role label
     */
    getRoleLabel(role: string): string {
        const labels: Record<string, string> = {
            'super_admin': 'Super Admin',
            'admin_dirjen': 'Admin Dirjen PTPP',
            'admin_sesditjen': 'Admin Sesditjen',
            'staff': 'Staff',
            'user': 'User',
        };
        return labels[role] || role;
    },

    /**
     * List all unit kerja for dropdown
     */
    async listUnitKerja() {
        return db
            .select({
                id: unitKerja.id,
                name: unitKerja.name,
            })
            .from(unitKerja)
            .orderBy(unitKerja.name);
    },
};

export default userManagementService;
