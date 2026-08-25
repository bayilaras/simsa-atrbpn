import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Chainable DB Mock ───
const resultQueue: any[] = [];
function enqueue(...results: any[]) { resultQueue.push(...results); }

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const val = resultQueue.shift() ?? [];
            return (resolve: any) => resolve(val);
        }
        return (..._args: any[]) => mockChain;
    },
});

const mockDb = {
    select: (..._a: any[]) => mockChain,
    insert: vi.fn((..._a: any[]) => mockChain),
    update: (..._a: any[]) => mockChain,
    delete: vi.fn((..._a: any[]) => mockChain),
    transaction: vi.fn(async (callback: any) => callback(mockDb)),
};

vi.mock('../config/database', () => ({ db: mockDb }));
vi.mock('better-auth/crypto', () => ({
    hashPassword: vi.fn().mockResolvedValue('secure-password-hash'),
}));

const { userManagementService, VALID_ROLES, ADMIN_ROLES } = await import('../services/user-management.service');

describe('userManagementService', () => {
    beforeEach(() => {
        resultQueue.length = 0;
        vi.clearAllMocks();
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

    // ── DB operations (with mock) ──
    describe('createUser', () => {
        it('provisions a credential account without using the public sign-up endpoint', async () => {
            enqueue(
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
            });

            expect(result).toEqual({ id: 'u-new', email: 'new@example.go.id', role: 'staff' });
            expect(mockDb.transaction).toHaveBeenCalledOnce();
            expect(mockDb.insert).toHaveBeenCalledTimes(2);
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
                userManagementService.updateUser('u1', { role: 'invalid' as any })
            ).rejects.toThrow('Invalid role: invalid');
        });

        it('should revoke existing sessions after a role change', async () => {
            enqueue(
                [{ id: 'u1', role: 'staff' }],
                [{ id: 'u1', role: 'staff' }],
                [],
            );

            const result = await userManagementService.updateUser('u1', { role: 'staff' });

            expect(result).toEqual({ id: 'u1', role: 'staff' });
            expect(mockDb.delete).toHaveBeenCalledTimes(1);
        });
    });

    describe('deactivateUser', () => {
        it('should call updateUser with isActive false', async () => {
            // When deactivating, updateUser will:
            // 1. select unitKerja (not needed since no unitKerjaId)
            // 2. update + returning
            // 3. getUserById for the return
            enqueue(
                [{ id: 'u1' }],              // update().returning()
                [{ id: 'u1', isActive: false }], // getUserById
            );
            const result = await userManagementService.deactivateUser('u1');
            expect(result).toEqual({ id: 'u1', isActive: false });
        });
    });
});
