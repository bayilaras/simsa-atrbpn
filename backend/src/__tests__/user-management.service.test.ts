import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Chainable DB Mock ───
const resultQueue: any[] = [];
const chainCalls: Array<{ method: PropertyKey; args: any[] }> = [];
let transactionCommits = 0;
let transactionRollbacks = 0;
function enqueue(...results: any[]) { resultQueue.push(...results); }
function enqueueError(error: unknown) { resultQueue.push({ queuedError: error }); }
const auditMocks = vi.hoisted(() => ({ logActionOrThrow: vi.fn() }));
const passwordMocks = vi.hoisted(() => ({ hashPassword: vi.fn() }));
const firebaseAuthMocks = vi.hoisted(() => ({
    createUser: vi.fn(),
    deleteUser: vi.fn(),
    updateUser: vi.fn(),
    revokeRefreshTokens: vi.fn(),
}));

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const val = resultQueue.shift() ?? [];
            return (resolve: any, reject: any) => (
                val && typeof val === 'object' && 'queuedError' in val
                    ? reject(val.queuedError)
                    : resolve(val)
            );
        }
        return (...args: any[]) => {
            chainCalls.push({ method: prop, args });
            return mockChain;
        };
    },
});

const mockDb = {
    select: vi.fn((..._a: any[]) => mockChain),
    insert: vi.fn((..._a: any[]) => mockChain),
    update: vi.fn((..._a: any[]) => mockChain),
    delete: vi.fn((..._a: any[]) => mockChain),
    execute: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(async (callback: any) => {
        try {
            const result = await callback(mockDb);
            transactionCommits += 1;
            return result;
        } catch (error) {
            transactionRollbacks += 1;
            throw error;
        }
    }),
};

vi.mock('../config/database', () => ({ db: mockDb }));
vi.mock('../services/audit-log.service.js', () => ({ default: auditMocks }));
vi.mock('better-auth/crypto', () => ({
    hashPassword: passwordMocks.hashPassword,
}));
vi.mock('../config/firebase-admin.js', () => ({
    getFirebaseAdminAuth: () => firebaseAuthMocks,
}));

const {
    userManagementService,
    VALID_ROLES,
    ADMIN_ROLES,
    FIREBASE_ADMIN_CREATED_EMAIL_VERIFIED,
    normalizeUserUnitAssignment,
} = await import('../services/user-management.service');

const activeSuperAdmin = {
    id: 'super-admin-2',
    email: 'super-admin-2@example.go.id',
    role: 'super_admin',
    unitKerjaId: null,
    isActive: true,
};
const actorContext = {
    userId: activeSuperAdmin.id,
    userEmail: activeSuperAdmin.email,
};

describe('userManagementService', () => {
    beforeEach(() => {
        resultQueue.length = 0;
        chainCalls.length = 0;
        vi.clearAllMocks();
        transactionCommits = 0;
        transactionRollbacks = 0;
        auditMocks.logActionOrThrow.mockResolvedValue(undefined);
        passwordMocks.hashPassword.mockResolvedValue('secure-password-hash');
        firebaseAuthMocks.createUser.mockResolvedValue({
            uid: 'firebase-uid-default',
            email: 'new@example.go.id',
        });
        firebaseAuthMocks.deleteUser.mockResolvedValue(undefined);
        firebaseAuthMocks.updateUser.mockResolvedValue({});
        firebaseAuthMocks.revokeRefreshTokens.mockResolvedValue(undefined);
        vi.stubEnv('AUTH_PROVIDER', 'better-auth');
        vi.stubEnv('SIMSA_CLOUD_PLATFORM', 'local');
        vi.stubEnv('FIREBASE_PROJECT_ID', '');
    });

    // ── Pure functions (no DB) ──
    describe('getRoles', () => {
        it('should return all valid roles with labels', () => {
            const roles = userManagementService.getRoles();
            expect(roles).toHaveLength(VALID_ROLES.length);
            expect(roles[0]).toHaveProperty('value');
            expect(roles[0]).toHaveProperty('label');
        });

        it('should include super_admin role', () => {
            const roles = userManagementService.getRoles();
            const superAdmin = roles.find((r: any) => r.value === 'super_admin');
            expect(superAdmin).toBeDefined();
            expect(superAdmin!.label).toBe('Super Admin');
        });

        it('should include all 6 roles', () => {
            const roles = userManagementService.getRoles();
            const values = roles.map((r: any) => r.value);
            expect(values).toContain('super_admin');
            expect(values).toContain('admin_dirjen');
            expect(values).toContain('admin_sesditjen');
            expect(values).toContain('staff');
            expect(values).toContain('auditor');
            expect(values).toContain('user');
        });
    });

    describe('getRoleLabel', () => {
        it('should return correct labels for all roles', () => {
            expect(userManagementService.getRoleLabel('super_admin')).toBe('Super Admin');
            expect(userManagementService.getRoleLabel('admin_dirjen')).toBe('Admin Dirjen PTPP');
            expect(userManagementService.getRoleLabel('admin_sesditjen')).toBe('Admin Sesditjen');
            expect(userManagementService.getRoleLabel('auditor')).toBe('Auditor (Unit Terbatas)');
            expect(userManagementService.getRoleLabel('user')).toBe('User');
        });

        it('should return raw role string for unknown role', () => {
            expect(userManagementService.getRoleLabel('unknown_role')).toBe('unknown_role');
        });
    });

    // ── Constants ──
    describe('VALID_ROLES', () => {
        it('should contain exactly 6 roles', () => {
            expect(VALID_ROLES).toHaveLength(6);
        });

        it('should be an array of strings', () => {
            expect(Array.isArray(VALID_ROLES)).toBe(true);
            VALID_ROLES.forEach((role: string) => expect(typeof role).toBe('string'));
        });
    });

    describe('ADMIN_ROLES', () => {
        it('should contain only super_admin', () => {
            expect(ADMIN_ROLES).toEqual(['super_admin']);
        });
    });

    describe('normalizeUserUnitAssignment', () => {
        it('canonicalizes omitted fixed-unit assignments for administrator roles', () => {
            expect(normalizeUserUnitAssignment('admin_dirjen', null, false)).toBe('ditjen');
            expect(normalizeUserUnitAssignment('admin_sesditjen', 'stale-unit', false)).toBe('sesditjen');
        });

        it('rejects explicit null or mismatched fixed-unit assignments', () => {
            expect(() => normalizeUserUnitAssignment('admin_dirjen', null, true))
                .toThrow(/Invalid unitKerjaId/);
            expect(() => normalizeUserUnitAssignment('admin_dirjen', 'sesditjen', true))
                .toThrow(/Invalid unitKerjaId/);
            expect(() => normalizeUserUnitAssignment('admin_sesditjen', null, true))
                .toThrow(/Invalid unitKerjaId/);
            expect(() => normalizeUserUnitAssignment('admin_sesditjen', 'ditjen', true))
                .toThrow(/Invalid unitKerjaId/);
        });

        it('canonicalizes every super-admin assignment to cross-unit null', () => {
            expect(normalizeUserUnitAssignment('super_admin', null, false)).toBeNull();
            expect(normalizeUserUnitAssignment('super_admin', 'ditjen', true)).toBeNull();
        });
    });

    // ── DB operations (with mock) ──
    describe('createUser', () => {
        it('rejects an explicit null unit for a fixed-unit administrator before opening a transaction', async () => {
            await expect(userManagementService.createUser({
                email: 'admin-dirjen@example.go.id',
                name: 'Admin Dirjen',
                role: 'admin_dirjen',
                unitKerjaId: null,
            }, actorContext)).rejects.toThrow(/Invalid unitKerjaId/);

            expect(mockDb.transaction).not.toHaveBeenCalled();
        });

        it('provisions a credential account without using the public sign-up endpoint', async () => {
            enqueue(
                [activeSuperAdmin],
                [],
                [{ id: 'u-new' }],
                [],
                [{ id: 'u-new', email: 'new@example.go.id', role: 'staff' }],
            );

            const result = await userManagementService.createUser({
                email: ' New@Example.go.id ',
                name: 'New User',
                role: 'staff',
                unitKerjaId: null,
                password: 'Strong-Password-2026!',
            }, actorContext);

            expect(result).toEqual({ id: 'u-new', email: 'new@example.go.id', role: 'staff' });
            expect(mockDb.transaction).toHaveBeenCalledOnce();
            expect(mockDb.insert).toHaveBeenCalledTimes(2);
        });

        it('preserves the legacy Better Auth duplicate-email behavior', async () => {
            enqueue([activeSuperAdmin], [{ id: 'existing-user' }]);

            await expect(userManagementService.createUser({
                email: 'existing@example.go.id',
                name: 'Existing User',
                role: 'staff',
                password: 'Strong-Password-2026!',
            }, actorContext)).rejects.toThrow('Email sudah terdaftar');

            expect(firebaseAuthMocks.createUser).not.toHaveBeenCalled();
            expect(firebaseAuthMocks.deleteUser).not.toHaveBeenCalled();
            expect(mockDb.insert).not.toHaveBeenCalled();
        });

        it('rolls back user provisioning when critical audit storage fails', async () => {
            enqueue([activeSuperAdmin], [], [{
                id: 'u-new', email: 'new@example.go.id', name: 'New User', role: 'staff',
                unitKerjaId: null, isActive: true,
            }]);
            auditMocks.logActionOrThrow.mockRejectedValueOnce(new Error('audit unavailable'));

            await expect(userManagementService.createUser({
                email: 'new@example.go.id',
                name: 'New User',
                role: 'staff',
                unitKerjaId: null,
            }, actorContext)).rejects.toThrow('audit unavailable');

            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
            expect(auditMocks.logActionOrThrow).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'create', entityType: 'user', entityId: 'u-new' }),
                mockDb,
            );
        });

        it('creates a usable verified Firebase identity and persists its UID without hashing the password', async () => {
            vi.stubEnv('AUTH_PROVIDER', 'firebase');
            vi.stubEnv('FIREBASE_PROJECT_ID', 'simsa-test-project');
            firebaseAuthMocks.createUser.mockResolvedValueOnce({
                uid: 'firebase-uid-1',
                email: 'new@example.go.id',
            });
            enqueue(
                [activeSuperAdmin], [],
                [activeSuperAdmin], [],
                [{
                    id: 'u-new', email: 'new@example.go.id', name: 'New User', role: 'staff',
                    unitKerjaId: null, isActive: true, firebaseUid: 'firebase-uid-1',
                }],
                [{ id: 'u-new', email: 'new@example.go.id', role: 'staff' }],
            );

            const result = await userManagementService.createUser({
                email: ' New@Example.go.id ',
                name: 'New User',
                role: 'staff',
                unitKerjaId: null,
                password: 'Transient-Only-2026!',
            }, actorContext);

            expect(result).toEqual({ id: 'u-new', email: 'new@example.go.id', role: 'staff' });
            expect(firebaseAuthMocks.createUser).toHaveBeenCalledWith({
                email: 'new@example.go.id',
                password: 'Transient-Only-2026!',
                displayName: 'New User',
                emailVerified: FIREBASE_ADMIN_CREATED_EMAIL_VERIFIED,
                disabled: false,
            });
            expect(passwordMocks.hashPassword).not.toHaveBeenCalled();
            expect(mockDb.insert).toHaveBeenCalledTimes(1);
            expect(chainCalls.filter(call => call.method === 'values')).toContainEqual({
                method: 'values',
                args: [expect.objectContaining({
                    firebaseUid: 'firebase-uid-1',
                    identityProvider: 'firebase',
                    emailVerified: true,
                })],
            });
            expect(JSON.stringify(chainCalls.filter(call => call.method === 'values')))
                .not.toContain('Transient-Only-2026!');
            expect(firebaseAuthMocks.deleteUser).not.toHaveBeenCalled();
            expect(transactionCommits).toBe(2);
        });

        it('requires a password before opening a transaction in Firebase mode', async () => {
            vi.stubEnv('AUTH_PROVIDER', 'firebase');
            vi.stubEnv('FIREBASE_PROJECT_ID', 'simsa-test-project');

            await expect(userManagementService.createUser({
                email: 'new@example.go.id',
                name: 'New User',
                role: 'staff',
            }, actorContext)).rejects.toThrow(/Password wajib/);

            expect(mockDb.transaction).not.toHaveBeenCalled();
            expect(firebaseAuthMocks.createUser).not.toHaveBeenCalled();
        });

        it('fails closed on an invalid auth-provider value instead of creating a Better Auth credential', async () => {
            vi.stubEnv('AUTH_PROVIDER', 'firebase-typo');

            await expect(userManagementService.createUser({
                email: 'new@example.go.id',
                name: 'New User',
                role: 'staff',
                password: 'Transient-Only-2026!',
            }, actorContext)).rejects.toThrow(/AUTH_PROVIDER must be one of/);

            expect(passwordMocks.hashPassword).not.toHaveBeenCalled();
            expect(firebaseAuthMocks.createUser).not.toHaveBeenCalled();
            expect(mockDb.transaction).not.toHaveBeenCalled();
        });

        it('compensates the Firebase identity when the DB/audit transaction fails', async () => {
            vi.stubEnv('AUTH_PROVIDER', 'firebase');
            vi.stubEnv('FIREBASE_PROJECT_ID', 'simsa-test-project');
            firebaseAuthMocks.createUser.mockResolvedValueOnce({
                uid: 'firebase-uid-compensate',
                email: 'new@example.go.id',
            });
            enqueue(
                [activeSuperAdmin], [],
                [activeSuperAdmin], [],
                [{
                    id: 'u-new', email: 'new@example.go.id', name: 'New User', role: 'staff',
                    unitKerjaId: null, isActive: true, firebaseUid: 'firebase-uid-compensate',
                }],
            );
            auditMocks.logActionOrThrow.mockRejectedValueOnce(new Error('audit unavailable'));

            await expect(userManagementService.createUser({
                email: 'new@example.go.id',
                name: 'New User',
                role: 'staff',
                password: 'Transient-Only-2026!',
            }, actorContext)).rejects.toThrow('audit unavailable');

            expect(firebaseAuthMocks.deleteUser).toHaveBeenCalledOnce();
            expect(firebaseAuthMocks.deleteUser).toHaveBeenCalledWith('firebase-uid-compensate');
            expect(transactionCommits).toBe(1);
            expect(transactionRollbacks).toBe(1);
        });

        it('fails closed when Firebase compensation fails and leaves no DB mapping', async () => {
            vi.stubEnv('AUTH_PROVIDER', 'firebase');
            vi.stubEnv('FIREBASE_PROJECT_ID', 'simsa-test-project');
            firebaseAuthMocks.createUser.mockResolvedValueOnce({
                uid: 'firebase-uid-orphan',
                email: 'new@example.go.id',
            });
            firebaseAuthMocks.deleteUser.mockRejectedValueOnce(new Error('firebase unavailable'));
            enqueue(
                [activeSuperAdmin], [],
                [activeSuperAdmin], [{ id: 'racing-db-user' }],
            );

            await expect(userManagementService.createUser({
                email: 'new@example.go.id',
                name: 'New User',
                role: 'staff',
                password: 'Transient-Only-2026!',
            }, actorContext)).rejects.toMatchObject({ statusCode: 503 });

            expect(firebaseAuthMocks.deleteUser).toHaveBeenCalledWith('firebase-uid-orphan');
            expect(mockDb.insert).not.toHaveBeenCalled();
        });

        it('treats an already-deleted Firebase identity as successful idempotent compensation', async () => {
            vi.stubEnv('AUTH_PROVIDER', 'firebase');
            vi.stubEnv('FIREBASE_PROJECT_ID', 'simsa-test-project');
            firebaseAuthMocks.createUser.mockResolvedValueOnce({
                uid: 'firebase-uid-race-cleaned',
                email: 'new@example.go.id',
            });
            firebaseAuthMocks.deleteUser.mockRejectedValueOnce(
                Object.assign(new Error('missing'), { code: 'auth/user-not-found' }),
            );
            enqueue(
                [activeSuperAdmin], [],
                [activeSuperAdmin], [{ id: 'racing-db-user' }],
            );

            await expect(userManagementService.createUser({
                email: 'new@example.go.id',
                name: 'New User',
                role: 'staff',
                password: 'Transient-Only-2026!',
            }, actorContext)).rejects.toMatchObject({ statusCode: 409 });

            expect(firebaseAuthMocks.deleteUser).toHaveBeenCalledWith('firebase-uid-race-cleaned');
        });

        it('returns the same conflict for a concurrent Firebase email race without touching the DB', async () => {
            vi.stubEnv('AUTH_PROVIDER', 'firebase');
            vi.stubEnv('FIREBASE_PROJECT_ID', 'simsa-test-project');
            firebaseAuthMocks.createUser.mockRejectedValueOnce(
                Object.assign(new Error('email exists'), { code: 'auth/email-already-exists' }),
            );
            enqueue([activeSuperAdmin], []);

            await expect(userManagementService.createUser({
                email: 'new@example.go.id',
                name: 'New User',
                role: 'staff',
                password: 'Transient-Only-2026!',
            }, actorContext)).rejects.toMatchObject({
                statusCode: 409,
                message: 'Identitas pengguna tersebut sudah digunakan.',
            });

            expect(mockDb.insert).not.toHaveBeenCalled();
            expect(firebaseAuthMocks.deleteUser).not.toHaveBeenCalled();
        });

        it('compensates a Firebase identity after a DB unique race and returns a generic conflict', async () => {
            vi.stubEnv('AUTH_PROVIDER', 'firebase');
            vi.stubEnv('FIREBASE_PROJECT_ID', 'simsa-test-project');
            firebaseAuthMocks.createUser.mockResolvedValueOnce({
                uid: 'firebase-uid-race',
                email: 'new@example.go.id',
            });
            enqueue([activeSuperAdmin], [], [activeSuperAdmin], []);
            enqueueError(Object.assign(new Error('duplicate key'), { code: '23505' }));

            await expect(userManagementService.createUser({
                email: 'new@example.go.id',
                name: 'New User',
                role: 'staff',
                password: 'Transient-Only-2026!',
            }, actorContext)).rejects.toMatchObject({ statusCode: 409 });

            expect(firebaseAuthMocks.deleteUser).toHaveBeenCalledWith('firebase-uid-race');
        });
    });

    describe('getUserById', () => {
        it('should return user when found', async () => {
            const mockUser = { id: 'u1', name: 'Test User', email: 'test@test.com', role: 'user' };
            enqueue([mockUser]);
            const result = await userManagementService.getUserById('u1');
            expect(result).toEqual(mockUser);
        });

        it('should return null when not found', async () => {
            enqueue([]);
            const result = await userManagementService.getUserById('missing');
            expect(result).toBeNull();
        });
    });

    describe('listUsers', () => {
        it('should return paginated data', async () => {
            enqueue(
                [{ count: 2 }],
                [{ id: '1', name: 'A' }, { id: '2', name: 'B' }],
            );
            const result = await userManagementService.listUsers({});
            expect(result.data).toHaveLength(2);
            expect(result.pagination.total).toBe(2);
            expect(result.pagination.page).toBe(1);
            expect(result.pagination.limit).toBe(20);
        });

        it('should use custom page and limit', async () => {
            enqueue([{ count: 50 }], []);
            const result = await userManagementService.listUsers({ page: 2, limit: 10 });
            expect(result.pagination.page).toBe(2);
            expect(result.pagination.limit).toBe(10);
            expect(result.pagination.totalPages).toBe(5);
        });
    });

    describe('listUnitKerja', () => {
        it('should return list of units', async () => {
            const mockUnits = [
                { id: 'ditjen', name: 'Dirjen PTPP' },
                { id: 'sesditjen', name: 'Sesditjen' },
            ];
            enqueue(mockUnits);
            const result = await userManagementService.listUnitKerja();
            expect(result).toEqual(mockUnits);
        });
    });

    describe('updateUser', () => {
        it('should reject invalid role', async () => {
            await expect(
                userManagementService.updateUser('u1', { role: 'invalid' as any }, actorContext)
            ).rejects.toThrow('Invalid role: invalid');
        });

        it('rejects an in-flight mutation when the actor is no longer an active super admin', async () => {
            enqueue([{
                ...activeSuperAdmin,
                role: 'staff',
            }]);

            await expect(userManagementService.updateUser(
                'u1',
                { role: 'admin_dirjen' },
                actorContext,
            )).rejects.toThrow(/bukan super admin aktif/);

            expect(mockDb.execute).toHaveBeenCalledOnce();
            expect(mockDb.execute.mock.invocationCallOrder[0])
                .toBeLessThan(mockDb.select.mock.invocationCallOrder[0]);
            expect(mockDb.update).not.toHaveBeenCalled();
        });

        it('fails closed when a service mutation has no audit actor', async () => {
            await expect((userManagementService.updateUser as any)(
                'u1',
                { isActive: false },
                undefined,
            )).rejects.toThrow(/Konteks administrator wajib/);

            expect(mockDb.update).not.toHaveBeenCalled();
        });

        it('should revoke existing sessions after a role change', async () => {
            enqueue(
                [activeSuperAdmin],
                [{ id: 'u1', role: 'user', unitKerjaId: 'u1', isActive: true }],
                [],
                [{ id: 'u1', role: 'staff', unitKerjaId: 'u1', isActive: true }],
                [],
                [{ id: 'u1', role: 'staff' }],
            );

            const result = await userManagementService.updateUser('u1', { role: 'staff' }, actorContext);

            expect(result).toEqual({ id: 'u1', role: 'staff' });
            expect(mockDb.delete).toHaveBeenCalledTimes(1);
            expect(mockDb.execute).toHaveBeenCalledOnce();
        });

        it('rejects a role change while the user is the current approver of a pending letter', async () => {
            enqueue(
                [activeSuperAdmin],
                [{
                    id: 'approver-1', role: 'admin_dirjen', unitKerjaId: 'ditjen', isActive: true,
                }],
                [{ id: 'surat-1', nomorSurat: 'SK/17/2026' }],
            );

            await expect(userManagementService.updateUser(
                'approver-1',
                { role: 'staff' },
                actorContext,
            )).rejects.toThrow(/masih menjadi penyetuju aktif.*SK\/17\/2026/);

            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
            expect(mockDb.update).not.toHaveBeenCalled();
        });

        it('rejects self-deactivation inside the service transaction', async () => {
            enqueue([{
                id: 'super-admin-1', role: 'super_admin', unitKerjaId: null, isActive: true,
            }]);

            await expect(userManagementService.updateUser(
                'super-admin-1',
                { isActive: false },
                { userId: 'super-admin-1' },
            )).rejects.toThrow(/tidak dapat menonaktifkan akun sendiri/);

            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
            expect(mockDb.update).not.toHaveBeenCalled();
        });

        it('keeps at least one active super admin', async () => {
            enqueue(
                [activeSuperAdmin],
                [{
                    id: 'super-admin-1', role: 'super_admin', unitKerjaId: null, isActive: true,
                }],
                [{ count: 1 }],
            );

            await expect(userManagementService.updateUser(
                'super-admin-1',
                { role: 'staff' },
                actorContext,
            )).rejects.toThrow(/Minimal satu super admin aktif/);

            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
            expect(mockDb.update).not.toHaveBeenCalled();
        });

        it('commits Firebase deactivation in the DB before disabling the identity and revoking tokens', async () => {
            vi.stubEnv('AUTH_PROVIDER', 'firebase');
            vi.stubEnv('FIREBASE_PROJECT_ID', 'simsa-test-project');
            enqueue(
                [activeSuperAdmin],
                [{
                    id: 'u1', role: 'staff', unitKerjaId: 'ditjen', isActive: true,
                    firebaseUid: 'firebase-uid-u1',
                }],
                [],
                [{
                    id: 'u1', role: 'staff', unitKerjaId: 'ditjen', isActive: false,
                    firebaseUid: 'firebase-uid-u1',
                }],
                [],
                [{ id: 'u1', role: 'staff', isActive: false }],
            );

            const result = await userManagementService.updateUser(
                'u1',
                { isActive: false },
                actorContext,
            );

            expect(result).toEqual({ id: 'u1', role: 'staff', isActive: false });
            expect(transactionCommits).toBe(1);
            expect(firebaseAuthMocks.updateUser).toHaveBeenCalledWith(
                'firebase-uid-u1',
                { disabled: true },
            );
            expect(firebaseAuthMocks.revokeRefreshTokens).toHaveBeenCalledWith('firebase-uid-u1');
            expect(firebaseAuthMocks.updateUser.mock.invocationCallOrder[0])
                .toBeLessThan(firebaseAuthMocks.revokeRefreshTokens.mock.invocationCallOrder[0]);
        });

        it('enables a reactivated Firebase identity and revokes stale refresh tokens', async () => {
            vi.stubEnv('AUTH_PROVIDER', 'firebase');
            vi.stubEnv('FIREBASE_PROJECT_ID', 'simsa-test-project');
            enqueue(
                [activeSuperAdmin],
                [{
                    id: 'u1', role: 'staff', unitKerjaId: 'ditjen', isActive: false,
                    firebaseUid: 'firebase-uid-u1',
                }],
                [{
                    id: 'u1', role: 'staff', unitKerjaId: 'ditjen', isActive: true,
                    firebaseUid: 'firebase-uid-u1',
                }],
                [],
                [{ id: 'u1', role: 'staff', isActive: true }],
            );

            await userManagementService.updateUser('u1', { isActive: true }, actorContext);

            expect(firebaseAuthMocks.updateUser).toHaveBeenCalledWith(
                'firebase-uid-u1',
                { disabled: false },
            );
            expect(firebaseAuthMocks.revokeRefreshTokens).toHaveBeenCalledWith('firebase-uid-u1');
        });

        it('keeps the committed DB state authoritative and allows an idempotent retry after Firebase failure', async () => {
            vi.stubEnv('AUTH_PROVIDER', 'firebase');
            vi.stubEnv('FIREBASE_PROJECT_ID', 'simsa-test-project');
            firebaseAuthMocks.revokeRefreshTokens
                .mockRejectedValueOnce(new Error('firebase unavailable'))
                .mockResolvedValueOnce(undefined);
            enqueue(
                [activeSuperAdmin],
                [{
                    id: 'u1', role: 'staff', unitKerjaId: 'ditjen', isActive: true,
                    firebaseUid: 'firebase-uid-u1',
                }],
                [],
                [{
                    id: 'u1', role: 'staff', unitKerjaId: 'ditjen', isActive: false,
                    firebaseUid: 'firebase-uid-u1',
                }],
                [],
                [{ id: 'u1', role: 'staff', isActive: false }],
            );

            await expect(userManagementService.updateUser(
                'u1',
                { isActive: false },
                actorContext,
            )).rejects.toMatchObject({ statusCode: 503 });
            expect(transactionCommits).toBe(1);

            enqueue(
                [activeSuperAdmin],
                [{
                    id: 'u1', role: 'staff', unitKerjaId: 'ditjen', isActive: false,
                    firebaseUid: 'firebase-uid-u1',
                }],
                [{
                    id: 'u1', role: 'staff', unitKerjaId: 'ditjen', isActive: false,
                    firebaseUid: 'firebase-uid-u1',
                }],
                [{ id: 'u1', role: 'staff', isActive: false }],
            );

            const retry = await userManagementService.updateUser(
                'u1',
                { isActive: false },
                actorContext,
            );

            expect(retry).toEqual({ id: 'u1', role: 'staff', isActive: false });
            expect(firebaseAuthMocks.updateUser).toHaveBeenCalledTimes(2);
            expect(firebaseAuthMocks.revokeRefreshTokens).toHaveBeenCalledTimes(2);
        });

        it('does not call Firebase Admin for Better Auth updates', async () => {
            enqueue(
                [activeSuperAdmin],
                [{
                    id: 'u1', role: 'user', unitKerjaId: 'ditjen', isActive: true,
                    firebaseUid: 'legacy-unexpected-uid',
                }],
                [],
                [{
                    id: 'u1', role: 'staff', unitKerjaId: 'ditjen', isActive: true,
                    firebaseUid: 'legacy-unexpected-uid',
                }],
                [],
                [{ id: 'u1', role: 'staff' }],
            );

            await userManagementService.updateUser('u1', { role: 'staff' }, actorContext);

            expect(firebaseAuthMocks.updateUser).not.toHaveBeenCalled();
            expect(firebaseAuthMocks.revokeRefreshTokens).not.toHaveBeenCalled();
        });
    });

    describe('deactivateUser', () => {
        it('should call updateUser with isActive false', async () => {
            // Deactivation checks for active approval assignments before update.
            enqueue(
                [activeSuperAdmin],
                [{ id: 'u1', role: 'staff', unitKerjaId: 'ditjen', isActive: true }],
                [],
                [{ id: 'u1', isActive: false }],
                [],
                [{ id: 'u1', isActive: false }],
            );
            const result = await userManagementService.deactivateUser('u1', actorContext);
            expect(result).toEqual({ id: 'u1', isActive: false });
        });

        it('rejects deactivation while the user owns a pending approval step', async () => {
            enqueue(
                [activeSuperAdmin],
                [{
                    id: 'approver-1', role: 'admin_sesditjen', unitKerjaId: 'sesditjen', isActive: true,
                }],
                [{ id: 'surat-2', nomorSurat: null }],
            );

            await expect(userManagementService.deactivateUser(
                'approver-1',
                actorContext,
            )).rejects.toThrow(/masih menjadi penyetuju aktif/);

            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
            expect(mockDb.update).not.toHaveBeenCalled();
        });
    });
});
