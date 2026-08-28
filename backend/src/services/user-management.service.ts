import { db } from '../config/database';
import { users, unitKerja, sessions, accounts, suratKeluar } from '../db/schema';
import { eq, ilike, or, and, desc, sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';
import { ROLE_MANDATED_UNIT_KERJA } from '../utils/resolve-unit-kerja.js';
import { ConflictError, ForbiddenError, ValidationError } from '../utils/errors.js';
import { lockAuthorizationMandatesExclusive } from '../utils/authorization-mandate-lock.js';

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
export const VALID_ROLES = ['super_admin', 'admin_dirjen', 'admin_sesditjen', 'staff', 'auditor', 'user'] as const;
export type Role = typeof VALID_ROLES[number];

// Admin roles that can access user management
export const ADMIN_ROLES: Role[] = ['super_admin'];

export function normalizeUserUnitAssignment(
    role: Role,
    unitKerjaId: string | null | undefined,
    explicitUnit: boolean,
): string | null {
    // A super administrator is deliberately cross-unit. Persisting a nominal
    // unit would disagree with the runtime resolver and mislead administrators.
    if (role === 'super_admin') return null;

    const mandatedUnit = ROLE_MANDATED_UNIT_KERJA[role];
    if (!mandatedUnit) return unitKerjaId?.trim() || null;

    const normalized = unitKerjaId?.trim() || null;
    if (explicitUnit && normalized !== mandatedUnit) {
        throw new Error(`Invalid unitKerjaId for ${role}: expected ${mandatedUnit}`);
    }

    return mandatedUnit;
}

type UserManagementTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function requireActiveSuperAdminActor(
    tx: UserManagementTransaction,
    auditContext: CriticalAuditContext | undefined,
) {
    if (!auditContext?.userId) {
        throw new ForbiddenError('Konteks administrator wajib untuk perubahan pengguna.');
    }

    // Reload after the exclusive mandate gate is held. A request which passed
    // middleware before its actor was demoted/deactivated must not retain stale
    // super-admin authority inside this transaction.
    const [actor] = await tx
        .select()
        .from(users)
        .where(eq(users.id, auditContext.userId))
        .limit(1)
        .for('update');

    if (!actor || actor.isActive !== true || actor.role !== 'super_admin') {
        throw new ForbiddenError('Aktor bukan super admin aktif. Muat ulang sesi Anda.');
    }

    return actor;
}

function selectUserById(executor: Pick<typeof db, 'select'>, userId: string) {
    return executor
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
}

export const userManagementService = {
    /**
     * Create a new user (by Super Admin)
     */
    async createUser(data: CreateUserData, auditContext: CriticalAuditContext) {
        const normalizedEmail = data.email.trim().toLowerCase();
        // Validate role
        if (!VALID_ROLES.includes(data.role as Role)) {
            throw new Error(`Invalid role: ${data.role}`);
        }
        const normalizedUnitKerjaId = normalizeUserUnitAssignment(
            data.role as Role,
            data.unitKerjaId,
            Object.prototype.hasOwnProperty.call(data, 'unitKerjaId'),
        );

        // Public Better Auth sign-up is disabled in production. Provision the
        // user and optional credential account atomically through the same
        // supported password hasher, without temporarily exposing sign-up.
        const passwordHash = data.password ? await hashPassword(data.password) : null;
        return db.transaction(async (tx) => {
            await lockAuthorizationMandatesExclusive(tx);
            await requireActiveSuperAdminActor(tx, auditContext);

            const [existingUser] = await tx
                .select({ id: users.id })
                .from(users)
                .where(ilike(users.email, normalizedEmail))
                .limit(1);
            if (existingUser) throw new Error('Email sudah terdaftar');

            if (normalizedUnitKerjaId) {
                const [unit] = await tx
                    .select({ id: unitKerja.id })
                    .from(unitKerja)
                    .where(eq(unitKerja.id, normalizedUnitKerjaId))
                    .limit(1);
                if (!unit) throw new Error(`Invalid unitKerjaId: ${normalizedUnitKerjaId}`);
            }

            const [newUser] = await tx
                .insert(users)
                .values({
                    email: normalizedEmail,
                    name: data.name,
                    role: data.role,
                    unitKerjaId: normalizedUnitKerjaId,
                    jabatan: data.jabatan || null,
                    nip: data.nip || null,
                    isActive: true,
                    emailVerified: Boolean(passwordHash),
                })
                .returning();

            if (!newUser) throw new Error('Failed to create user');

            if (passwordHash) {
                await tx.insert(accounts).values({
                    userId: newUser.id,
                    issuer: 'local:credential',
                    accountId: newUser.id,
                    providerId: 'credential',
                    password: passwordHash,
                });
            }

            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'create',
                entityType: 'user',
                entityId: newUser.id,
                changes: {
                    after: {
                        email: newUser.email,
                        name: newUser.name,
                        role: newUser.role,
                        unitKerjaId: newUser.unitKerjaId,
                        isActive: newUser.isActive,
                    },
                },
            }, tx);

            const [profile] = await selectUserById(tx, newUser.id);
            return profile || newUser;
        });
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
        const [user] = await selectUserById(db, userId);

        return user || null;
    },

    /**
     * Update user (role, unitKerja, isActive)
     */
    async updateUser(
        userId: string,
        data: UpdateUserData,
        auditContext: CriticalAuditContext,
    ) {
        // Validate role if provided
        if (data.role && !VALID_ROLES.includes(data.role as Role)) {
            throw new Error(`Invalid role: ${data.role}`);
        }

        const updateData: any = {
            updatedAt: new Date(),
        };

        if (data.role !== undefined) updateData.role = data.role;
        if (data.isActive !== undefined) updateData.isActive = data.isActive;
        if (data.jabatan !== undefined) updateData.jabatan = data.jabatan;
        if (data.nip !== undefined) updateData.nip = data.nip;

        return db.transaction(async (tx) => {
        // Serialize every privileged user mutation with approval's shared gate,
        // then re-authorize the actor before locking the target. This gives role
        // revocation a transactionally observable boundary for in-flight calls.
        await lockAuthorizationMandatesExclusive(tx);
        const actor = await requireActiveSuperAdminActor(tx, auditContext);

        const existingUser = actor.id === userId
            ? actor
            : (await tx
                .select()
                .from(users)
                .where(eq(users.id, userId))
                .limit(1)
                .for('update'))[0];
        if (!existingUser) return null;

        if (auditContext?.userId === userId) {
            if (data.isActive === false && existingUser.isActive) {
                throw new ValidationError('Anda tidak dapat menonaktifkan akun sendiri.');
            }
            if (data.role !== undefined && data.role !== existingUser.role) {
                throw new ValidationError('Anda tidak dapat mengubah peran akun sendiri.');
            }
        }

        const removesActiveSuperAdmin = existingUser.role === 'super_admin'
            && existingUser.isActive
            && (
                (data.role !== undefined && data.role !== 'super_admin')
                || data.isActive === false
            );

        if (removesActiveSuperAdmin) {
            const [{ count }] = await tx
                .select({ count: sql<number>`count(*)` })
                .from(users)
                .where(and(eq(users.role, 'super_admin'), eq(users.isActive, true)));

            if (Number(count) <= 1) {
                throw new ConflictError('Minimal satu super admin aktif harus tetap tersedia.');
            }
        }

        const nextRole = (data.role ?? existingUser.role) as Role;
        const nextUnitKerjaId = normalizeUserUnitAssignment(
            nextRole,
            data.unitKerjaId !== undefined ? data.unitKerjaId : existingUser.unitKerjaId,
            data.unitKerjaId !== undefined,
        );

        const roleChanged = data.role !== undefined && data.role !== existingUser.role;
        const unitChanged = nextUnitKerjaId !== existingUser.unitKerjaId;
        const activeStateChanged = data.isActive !== undefined
            && data.isActive !== existingUser.isActive;
        const changesApprovalMandate = roleChanged
            || unitChanged
            || (data.isActive === false && existingUser.isActive);

        if (changesApprovalMandate) {
            const [pendingApproval] = await tx
                .select({
                    id: suratKeluar.id,
                    nomorSurat: suratKeluar.nomorSurat,
                })
                .from(suratKeluar)
                .where(and(
                    eq(suratKeluar.currentApproverId, userId),
                    eq(suratKeluar.approvalStatus, 'pending'),
                    eq(suratKeluar.isDeleted, false),
                ))
                .limit(1)
                .for('update');

            if (pendingApproval) {
                const reference = pendingApproval.nomorSurat
                    ? ` (${pendingApproval.nomorSurat})`
                    : '';
                throw new ConflictError(
                    `Pengguna masih menjadi penyetuju aktif untuk surat pending${reference}. `
                    + 'Selesaikan atau teruskan persetujuan terlebih dahulu.',
                );
            }
        }

        if (data.unitKerjaId !== undefined || nextUnitKerjaId !== existingUser.unitKerjaId) {
            updateData.unitKerjaId = nextUnitKerjaId;
        }

        if (nextUnitKerjaId && nextUnitKerjaId !== existingUser.unitKerjaId) {
            const [unit] = await tx
                .select({ id: unitKerja.id })
                .from(unitKerja)
                .where(eq(unitKerja.id, nextUnitKerjaId))
                .limit(1);
            if (!unit) throw new Error(`Invalid unitKerjaId: ${nextUnitKerjaId}`);
        }

        const [updatedUser] = await tx
            .update(users)
            .set(updateData)
            .where(eq(users.id, userId))
            .returning();

        if (!updatedUser) {
            return null;
        }

        if (roleChanged || unitChanged || activeStateChanged) {
            await tx.delete(sessions).where(eq(sessions.userId, userId));
        }

        await auditLogService.logActionOrThrow({
            ...auditContext,
            action: 'update',
            entityType: 'user',
            entityId: userId,
            changes: {
                before: {
                    role: existingUser.role,
                    unitKerjaId: existingUser.unitKerjaId,
                    isActive: existingUser.isActive,
                    jabatan: existingUser.jabatan,
                    nip: existingUser.nip,
                },
                after: {
                    role: updatedUser.role,
                    unitKerjaId: updatedUser.unitKerjaId,
                    isActive: updatedUser.isActive,
                    jabatan: updatedUser.jabatan,
                    nip: updatedUser.nip,
                },
                fields: Object.keys(data),
            },
        }, tx);

        const [profile] = await selectUserById(tx, userId);
        return profile || updatedUser;
        });
    },

    /**
     * Deactivate user (soft delete)
     */
    async deactivateUser(userId: string, auditContext: CriticalAuditContext) {
        return this.updateUser(userId, { isActive: false }, auditContext);
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
            'auditor': 'Auditor (Unit Terbatas)',
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
