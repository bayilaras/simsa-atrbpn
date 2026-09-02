import { db } from '../config/database';
import { users, unitKerja, sessions, accounts, suratKeluar } from '../db/schema';
import { eq, ilike, or, and, desc, sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import type { UserRecord } from 'firebase-admin/auth';
import { getFirebaseAdminAuth } from '../config/firebase-admin.js';
import { assertValidCloudPlatformEnvironment } from '../config/cloud-platform.js';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';
import { ROLE_MANDATED_UNIT_KERJA } from '../utils/resolve-unit-kerja.js';
import {
    AppError,
    ConflictError,
    ForbiddenError,
    ServiceUnavailableError,
    ValidationError,
} from '../utils/errors.js';
import { lockAuthorizationMandatesExclusive } from '../utils/authorization-mandate-lock.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('UserManagementService');

// The Firebase session boundary requires email_verified=true. Admin-created
// accounts therefore use an explicit administrator-attested verification
// policy and are immediately usable with the transient password supplied to
// Firebase Admin. A future email-invitation flow must change this policy and
// the session exchange together; silently creating an unusable unverified
// identity is not acceptable.
export const FIREBASE_ADMIN_CREATED_EMAIL_VERIFIED = true;

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

function userManagementAuthProvider() {
    return assertValidCloudPlatformEnvironment(process.env, {
        requireStorage: false,
    }).authProvider;
}

function externalErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
}

function isDatabaseUniqueViolation(error: unknown): boolean {
    return externalErrorCode(error) === '23505';
}

function firebaseProvisioningConflict(error: unknown): boolean {
    const code = externalErrorCode(error);
    return code === 'auth/email-already-exists' || code === 'auth/uid-already-exists';
}

function normalizeProvisioningError(error: unknown): unknown {
    if (error instanceof AppError) return error;
    if (isDatabaseUniqueViolation(error) || firebaseProvisioningConflict(error)) {
        // The caller is privileged, but keep the response identical for a DB
        // duplicate, a Firebase duplicate, and a concurrent create race.
        return new ConflictError('Identitas pengguna tersebut sudah digunakan.');
    }
    return error;
}

async function validateCreatePrerequisites(
    tx: UserManagementTransaction,
    normalizedEmail: string,
    normalizedUnitKerjaId: string | null,
    auditContext: CriticalAuditContext,
    duplicatePolicy: 'legacy' | 'generic',
) {
    await lockAuthorizationMandatesExclusive(tx);
    await requireActiveSuperAdminActor(tx, auditContext);

    const [existingUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(ilike(users.email, normalizedEmail))
        .limit(1);
    if (existingUser) {
        if (duplicatePolicy === 'legacy') throw new Error('Email sudah terdaftar');
        throw new ConflictError('Identitas pengguna tersebut sudah digunakan.');
    }

    if (normalizedUnitKerjaId) {
        const [unit] = await tx
            .select({ id: unitKerja.id })
            .from(unitKerja)
            .where(eq(unitKerja.id, normalizedUnitKerjaId))
            .limit(1);
        if (!unit) throw new ValidationError(`Invalid unitKerjaId: ${normalizedUnitKerjaId}`);
    }
}

interface PersistUserIdentity {
    provider: 'better_auth' | 'firebase';
    firebaseUid?: string;
    passwordHash?: string;
}

async function persistCreatedUser(
    data: CreateUserData,
    normalizedEmail: string,
    normalizedUnitKerjaId: string | null,
    identity: PersistUserIdentity,
    auditContext: CriticalAuditContext,
) {
    return db.transaction(async (tx) => {
        // Repeat all preflight checks after the external Firebase create. This
        // closes actor deactivation, unit deletion, and duplicate-email races.
        await validateCreatePrerequisites(
            tx,
            normalizedEmail,
            normalizedUnitKerjaId,
            auditContext,
            identity.provider === 'firebase' ? 'generic' : 'legacy',
        );

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
                emailVerified: identity.provider === 'firebase'
                    ? FIREBASE_ADMIN_CREATED_EMAIL_VERIFIED
                    : Boolean(identity.passwordHash),
                firebaseUid: identity.firebaseUid,
                identityProvider: identity.provider,
                authMigratedAt: identity.provider === 'firebase' ? new Date() : undefined,
            })
            .returning();

        if (!newUser) throw new Error('Failed to create user');

        if (identity.provider === 'better_auth' && identity.passwordHash) {
            await tx.insert(accounts).values({
                userId: newUser.id,
                issuer: 'local:credential',
                accountId: newUser.id,
                providerId: 'credential',
                password: identity.passwordHash,
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
                    identityProvider: identity.provider,
                },
            },
        }, tx);

        const [profile] = await selectUserById(tx, newUser.id);
        return profile || newUser;
    });
}

async function compensateFirebaseCreate(firebaseUid: string, cause: unknown): Promise<never> {
    try {
        await getFirebaseAdminAuth().deleteUser(firebaseUid);
    } catch (compensationError) {
        // A concurrent reconciler may already have removed the same orphan.
        // Firebase's not-found result is therefore a successful idempotent
        // compensation, not a new incident.
        if (externalErrorCode(compensationError) === 'auth/user-not-found') {
            throw normalizeProvisioningError(cause);
        }
        // A process crash in the same create->persist window has the same
        // residual shape. It cannot enter SIMSA because no DB mapping exists;
        // the identity:firebase:plan reconciliation command reports the
        // verified unmatched Firebase identity for operator cleanup.
        log.error({
            err: compensationError,
            firebaseUid,
            originalError: cause,
        }, 'Firebase provisioning compensation failed; unmatched identity requires reconciliation');
        throw new ServiceUnavailableError(
            'Provisioning pengguna belum dapat dipastikan. Jalankan rekonsiliasi identitas sebelum mencoba lagi.',
        );
    }
    throw normalizeProvisioningError(cause);
}

async function synchronizeFirebaseAuthorizationState(
    firebaseUid: string,
    isActive: boolean,
    revokeSessions: boolean,
): Promise<void> {
    const firebaseAuth = getFirebaseAdminAuth();
    try {
        // updateUser and revokeRefreshTokens are idempotent for retries. The DB
        // commit happens first and remains the authorization authority even if
        // Firebase is temporarily unavailable.
        await firebaseAuth.updateUser(firebaseUid, { disabled: !isActive });
        if (revokeSessions) await firebaseAuth.revokeRefreshTokens(firebaseUid);
    } catch (error) {
        log.error({ err: error, firebaseUid, desiredActiveState: isActive },
            'Database user state committed but Firebase authorization reconciliation failed');
        throw new ServiceUnavailableError(
            'Perubahan pengguna tersimpan, tetapi sinkronisasi sesi belum selesai. Ulangi permintaan ini.',
        );
    }
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
        const authProvider = userManagementAuthProvider();

        if (authProvider === 'better-auth') {
            // Preserve legacy behavior exactly: Better Auth receives its own
            // scrypt hash and an optional credential account is stored in the
            // same transaction as the domain user and critical audit record.
            const passwordHash = data.password ? await hashPassword(data.password) : undefined;
            return persistCreatedUser(
                data,
                normalizedEmail,
                normalizedUnitKerjaId,
                { provider: 'better_auth', passwordHash },
                auditContext,
            );
        }

        if (!data.password) {
            throw new ValidationError(
                'Password wajib untuk akun Firebase yang dibuat administrator.',
            );
        }

        // Verify authority and obvious conflicts before creating an external
        // identity. The persistence transaction repeats these checks to close
        // the race between this commit and Firebase Admin.
        await db.transaction(async (tx) => {
            await validateCreatePrerequisites(
                tx,
                normalizedEmail,
                normalizedUnitKerjaId,
                auditContext,
                'generic',
            );
        });

        const firebaseAuth = getFirebaseAdminAuth();
        let firebaseUser: UserRecord;
        try {
            // The plaintext password exists only in this request and Firebase
            // Admin call. It is never hashed, logged, audited, or persisted by
            // the SIMSA backend in Firebase mode.
            firebaseUser = await firebaseAuth.createUser({
                email: normalizedEmail,
                password: data.password,
                displayName: data.name,
                emailVerified: FIREBASE_ADMIN_CREATED_EMAIL_VERIFIED,
                disabled: false,
            });
        } catch (error) {
            throw normalizeProvisioningError(error);
        }

        if (
            !firebaseUser.uid
            || firebaseUser.uid.length > 128
            || firebaseUser.email?.trim().toLowerCase() !== normalizedEmail
        ) {
            return compensateFirebaseCreate(
                firebaseUser.uid,
                new Error('Firebase returned an invalid or mismatched user record'),
            );
        }

        try {
            return await persistCreatedUser(
                data,
                normalizedEmail,
                normalizedUnitKerjaId,
                { provider: 'firebase', firebaseUid: firebaseUser.uid },
                auditContext,
            );
        } catch (error) {
            return compensateFirebaseCreate(firebaseUser.uid, error);
        }
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

        const authProvider = userManagementAuthProvider();
        const mutation = await db.transaction(async (tx) => {
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
        return {
            publicUser: profile || updatedUser,
            firebaseUid: updatedUser.firebaseUid,
            isActive: updatedUser.isActive,
            // Use requested authorization fields, not only state deltas. If a
            // previous post-commit Firebase call failed, retrying the same
            // idempotent request must still finish token revocation.
            revokeFirebaseSessions: data.role !== undefined
                || data.unitKerjaId !== undefined
                || data.isActive !== undefined,
        };
        });

        if (!mutation) return null;
        if (authProvider === 'firebase' && mutation.firebaseUid) {
            await synchronizeFirebaseAuthorizationState(
                mutation.firebaseUid,
                mutation.isActive,
                mutation.revokeFirebaseSessions,
            );
        }
        return mutation.publicUser;
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
