import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Chainable DB Mock ───
const resultQueue: any[] = [];
const chainCalls: Array<{ method: PropertyKey; args: any[] }> = [];
let transactionCommits = 0;
let transactionRollbacks = 0;
function enqueue(...results: any[]) { resultQueue.push(...results); }
function enqueueError(error: unknown) { resultQueue.push({ queuedError: error }); }
const auditMocks = vi.hoisted(() => ({ logActionOrThrow: vi.fn() }));
const logMocks = vi.hoisted(() => ({ error: vi.fn() }));
const passwordMocks = vi.hoisted(() => ({ hashPassword: vi.fn() }));

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
vi.mock('../utils/logger.js', () => ({ createLogger: () => logMocks }));
vi.mock('better-auth/crypto', () => ({
    hashPassword: passwordMocks.hashPassword,
}));

const {
    userManagementService,
    VALID_ROLES,
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
        vi.stubEnv('AUTH_PROVIDER', 'better-auth');
        vi.stubEnv('SIMSA_CLOUD_PLATFORM', 'local');
    });

    // ── Pure functions (no DB) ──
    describe('canonical unit administrator provisioning', () => {
        it('validates and persists an existing assigned unit', async () => {
            const created = { id: 'new-admin', role: 'admin_unit', unitKerjaId: 'unit-a', isActive: true };
            enqueue([activeSuperAdmin], [], [{ id: 'unit-a' }], [created], [created]);
            const result = await userManagementService.createUser({ email: 'unit@example.test', name: 'Admin Unit', role: 'admin_unit', unitKerjaId: ' unit-a ' }, actorContext);
            expect(result).toMatchObject({ role: 'admin_unit', unitKerjaId: 'unit-a' });
            expect(chainCalls.some(call => call.method === 'values' && call.args[0]?.role === 'admin_unit' && call.args[0]?.unitKerjaId === 'unit-a')).toBe(true);
        });
        it('rejects a nonexistent unit before inserting an account', async () => {
            enqueue([activeSuperAdmin], [], []);
            await expect(userManagementService.createUser({ email: 'unit@example.test', name: 'Admin Unit', role: 'admin_unit', unitKerjaId: 'missing' }, actorContext)).rejects.toThrow(/Invalid unitKerjaId/);
            expect(mockDb.insert).not.toHaveBeenCalled();
        });
        it('does not allow removing an existing admin_unit mandate', async () => {
            enqueue([activeSuperAdmin], [{ id: 'unit-admin', role: 'admin_unit', unitKerjaId: 'unit-a', isActive: true }]);
            await expect(userManagementService.updateUser('unit-admin', { unitKerjaId: null }, actorContext)).rejects.toThrow(/Unit kerja wajib/);
            expect(mockDb.update).not.toHaveBeenCalled();
        });
        it('rejects an admin_unit trying to provision another account or promote itself', async () => {
            enqueue([{ id: 'unit-admin', role: 'admin_unit', unitKerjaId: 'unit-a', isActive: true }]);
            await expect(userManagementService.updateUser('unit-admin', { role: 'super_admin' }, { userId: 'unit-admin', userEmail: 'unit@example.test' })).rejects.toThrow(/bukan super admin aktif/);
            expect(mockDb.update).not.toHaveBeenCalled();
        });
    });
    describe('pending identity approval', () => {
        const pending = { id: 'pending-google', role: 'user', unitKerjaId: null, isActive: true };
        it('requires a role before assigning a pending identity to a unit', async () => {
            const incomplete = { ...pending, unitKerjaId: 'unit-a' };
            enqueue([activeSuperAdmin], [pending], [], [{ id: 'unit-a' }], [incomplete], [], [incomplete]);
            await expect(userManagementService.updateUser(pending.id, { unitKerjaId: 'unit-a' }, actorContext)).rejects.toThrow(/Pilih peran/);
            expect(mockDb.update).not.toHaveBeenCalled();
        });
        it('does not reuse a legacy pending unit for implicit admin_unit approval', async () => {
            const approved = { ...pending, role: 'admin_unit', unitKerjaId: 'legacy-unit' };
            enqueue([activeSuperAdmin], [{ ...pending, unitKerjaId: 'legacy-unit' }], [], [approved], [], [approved]);
            await expect(userManagementService.updateUser(pending.id, { role: 'admin_unit' }, actorContext)).rejects.toThrow(/Unit kerja wajib/);
            expect(mockDb.update).not.toHaveBeenCalled();
        });
        it('requires a unit when explicitly approving an admin_unit identity', async () => {
            enqueue([activeSuperAdmin], [pending]);
            await expect(userManagementService.updateUser(pending.id, { role: 'admin_unit' }, actorContext)).rejects.toThrow(/Unit kerja wajib/);
            expect(mockDb.update).not.toHaveBeenCalled();
        });
        it('approves explicit role and valid unit atomically with audit and session revocation', async () => {
            const approved = { ...pending, role: 'admin_unit', unitKerjaId: 'unit-a' };
            enqueue([activeSuperAdmin], [pending], [], [{ id: 'unit-a' }], [approved], [], [approved]);
            await expect(userManagementService.updateUser(pending.id, { role: 'admin_unit', unitKerjaId: 'unit-a' }, actorContext)).resolves.toMatchObject(approved);
            expect(transactionCommits).toBe(1);
            expect(mockDb.delete).toHaveBeenCalledOnce();
            expect(auditMocks.logActionOrThrow).toHaveBeenCalledWith(expect.objectContaining({ entityId: pending.id, changes: expect.objectContaining({ after: expect.objectContaining({ role: 'admin_unit', unitKerjaId: 'unit-a' }) }) }), mockDb);
        });
    });
    describe('getRoles', () => {
        it('should return all valid roles with labels', () => {
            const roles = userManagementService.getRoles();
            expect(roles).toHaveLength(2);
            expect(roles[0]).toHaveProperty('value');
            expect(roles[0]).toHaveProperty('label');
        });

        it('should include super_admin role', () => {
            const roles = userManagementService.getRoles();
            const superAdmin = roles.find((r: any) => r.value === 'super_admin');
            expect(superAdmin).toBeDefined();
            expect(superAdmin!.label).toBe('Super Admin');
        });

        it('offers only the two assignable roles while retaining legacy labels', () => {
            expect(userManagementService.getRoles().map(role => role.value)).toEqual(['super_admin', 'admin_unit']);
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
        it('retains six legacy roles plus admin_unit', () => {
            expect(VALID_ROLES).toHaveLength(7);
        });

        it('should be an array of strings', () => {
            expect(Array.isArray(VALID_ROLES)).toBe(true);
            VALID_ROLES.forEach((role: string) => expect(typeof role).toBe('string'));
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
                role: 'admin_unit',
                unitKerjaId: null,
            }, actorContext)).rejects.toThrow(/Unit kerja wajib/);

            expect(mockDb.transaction).not.toHaveBeenCalled();
        });

        it('provisions a credential account without using the public sign-up endpoint', async () => {
            enqueue(
                [activeSuperAdmin],
                [],
                [{ id: 'u-new' }],
                [],
                [{ id: 'u-new', email: 'new@example.go.id', role: 'super_admin' }],
            );

            const result = await userManagementService.createUser({
                email: ' New@Example.go.id ',
                name: 'New User',
                role: 'super_admin',
                unitKerjaId: null,
                password: 'Strong-Password-2026!',
            }, actorContext);

            expect(result).toEqual({ id: 'u-new', email: 'new@example.go.id', role: 'super_admin' });
            expect(mockDb.transaction).toHaveBeenCalledOnce();
            expect(mockDb.insert).toHaveBeenCalledTimes(2);
        });

        it('preserves the legacy Better Auth duplicate-email behavior', async () => {
            enqueue([activeSuperAdmin], [{ id: 'existing-user' }]);

            await expect(userManagementService.createUser({
                email: 'existing@example.go.id',
                name: 'Existing User',
                role: 'super_admin',
                password: 'Strong-Password-2026!',
            }, actorContext)).rejects.toMatchObject({ statusCode: 400, message: 'Email sudah terdaftar' });

            expect(mockDb.insert).not.toHaveBeenCalled();
        });

        it('rolls back user provisioning when critical audit storage fails', async () => {
            enqueue([activeSuperAdmin], [], [{
                id: 'u-new', email: 'new@example.go.id', name: 'New User', role: 'super_admin',
                unitKerjaId: null, isActive: true,
            }]);
            auditMocks.logActionOrThrow.mockRejectedValueOnce(new Error('audit unavailable'));

            await expect(userManagementService.createUser({
                email: 'new@example.go.id',
                name: 'New User',
                role: 'super_admin',
                unitKerjaId: null,
            }, actorContext)).rejects.toThrow('audit unavailable');

            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
            expect(auditMocks.logActionOrThrow).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'create', entityType: 'user', entityId: 'u-new' }),
                mockDb,
            );
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
            ).rejects.toMatchObject({ statusCode: 400, message: 'Invalid role: invalid' });
        });

        it('rejects an in-flight mutation when the actor is no longer an active super admin', async () => {
            enqueue([{
                ...activeSuperAdmin,
                role: 'staff',
            }]);

            await expect(userManagementService.updateUser(
                'u1',
                { role: 'admin_unit' },
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
                [{ id: 'u1', role: 'admin_unit', unitKerjaId: 'u1', isActive: true }],
                [],
                [{ id: 'u1', role: 'admin_unit' }],
            );

            const result = await userManagementService.updateUser('u1', { role: 'admin_unit', unitKerjaId: 'u1' }, actorContext);

            expect(result).toEqual({ id: 'u1', role: 'admin_unit' });
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
                { role: 'admin_unit' },
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
                { role: 'admin_unit' },
                actorContext,
            )).rejects.toThrow(/Minimal satu super admin aktif/);

            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
            expect(mockDb.update).not.toHaveBeenCalled();
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

    describe('resetPassword', () => {
        const target = { id: 'unit-admin', role: 'admin_unit', isActive: true };

        it('rejects a demoted actor before touching credentials or sessions', async () => {
            enqueue([{ ...activeSuperAdmin, role: 'admin_unit', unitKerjaId: 'unit-a' }]);
            await expect(userManagementService.resetPassword(target.id, 'synthetic-password', actorContext))
                .rejects.toThrow(/bukan super admin aktif/);
            expect(mockDb.update).not.toHaveBeenCalled();
            expect(mockDb.insert).not.toHaveBeenCalled();
            expect(mockDb.delete).not.toHaveBeenCalled();
        });

        it('stores only the Better Auth hash and rolls back when the audit record fails', async () => {
            auditMocks.logActionOrThrow.mockRejectedValueOnce(new Error('audit unavailable'));
            enqueue([activeSuperAdmin], [target], [{ id: 'credential-1' }], [{ id: 'session-1' }]);
            await expect(userManagementService.resetPassword(target.id, 'synthetic-password', actorContext))
                .rejects.toThrow('audit unavailable');
            expect(passwordMocks.hashPassword).toHaveBeenCalledWith('synthetic-password');
            const written = chainCalls.find(call => call.method === 'set')?.args[0];
            expect(written).toMatchObject({ password: 'secure-password-hash' });
            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
        });
    });
});
