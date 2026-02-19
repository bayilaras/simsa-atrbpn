import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    hasPermission,
    canAccessUnit,
    isReadOnlyRole,
    getAllowedActions,
    PERMISSIONS,
    ROLE_HIERARCHY,
    type Role,
    type Module,
    type Action,
} from '../config/permissions';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middlewares/auth.middleware';

// ── Permission Helper Tests ──────────────────────────────────────────────────

describe('hasPermission', () => {
    it('super_admin should have all permissions on surat_masuk', () => {
        const actions: Action[] = ['read', 'create', 'update', 'delete', 'archive', 'export'];
        actions.forEach(action => {
            expect(hasPermission('super_admin', 'surat_masuk', action)).toBe(true);
        });
    });

    it('user should only have read permission on surat_masuk', () => {
        expect(hasPermission('user', 'surat_masuk', 'read')).toBe(true);
        expect(hasPermission('user', 'surat_masuk', 'create')).toBe(false);
        expect(hasPermission('user', 'surat_masuk', 'update')).toBe(false);
        expect(hasPermission('user', 'surat_masuk', 'delete')).toBe(false);
    });

    it('auditor should have read and export but not create/update/delete', () => {
        expect(hasPermission('auditor', 'surat_masuk', 'read')).toBe(true);
        expect(hasPermission('auditor', 'surat_masuk', 'export')).toBe(true);
        expect(hasPermission('auditor', 'surat_masuk', 'create')).toBe(false);
        expect(hasPermission('auditor', 'surat_masuk', 'delete')).toBe(false);
    });

    it('only super_admin can destroy archives', () => {
        expect(hasPermission('super_admin', 'arsip', 'destroy')).toBe(true);
        expect(hasPermission('admin_dirjen', 'arsip', 'destroy')).toBe(false);
        expect(hasPermission('admin_sesditjen', 'arsip', 'destroy')).toBe(false);
        expect(hasPermission('auditor', 'arsip', 'destroy')).toBe(false);
        expect(hasPermission('user', 'arsip', 'destroy')).toBe(false);
    });

    it('only super_admin can manage users', () => {
        expect(hasPermission('super_admin', 'user_management', 'create')).toBe(true);
        expect(hasPermission('super_admin', 'user_management', 'update')).toBe(true);
        expect(hasPermission('super_admin', 'user_management', 'delete')).toBe(true);
        expect(hasPermission('admin_dirjen', 'user_management', 'create')).toBe(false);
    });

    it('should return false for non-existent module', () => {
        expect(hasPermission('super_admin', 'non_existent' as Module, 'read')).toBe(false);
    });

    it('should return false for non-existent action on existing module', () => {
        expect(hasPermission('super_admin', 'audit_log', 'delete' as Action)).toBe(false);
    });
});

describe('canAccessUnit', () => {
    it('super_admin should access all units (wildcard)', () => {
        expect(canAccessUnit('super_admin', null, 'dirjen-ptpp')).toBe(true);
        expect(canAccessUnit('super_admin', null, 'sesditjen-umum')).toBe(true);
        expect(canAccessUnit('super_admin', null, 'any-unit')).toBe(true);
    });

    it('auditor should access all units (wildcard, read-only role)', () => {
        expect(canAccessUnit('auditor', null, 'dirjen-ptpp')).toBe(true);
        expect(canAccessUnit('auditor', null, 'sesditjen-umum')).toBe(true);
    });

    it('user should only access their own unit', () => {
        expect(canAccessUnit('user', 'dirjen-ptpp', 'dirjen-ptpp')).toBe(true);
        expect(canAccessUnit('user', 'dirjen-ptpp', 'sesditjen-umum')).toBe(false);
    });

    it('admin_dirjen should access dirjen and sub-units', () => {
        expect(canAccessUnit('admin_dirjen', 'dirjen-ptpp', 'dirjen-ptpp')).toBe(true);
        expect(canAccessUnit('admin_dirjen', 'dirjen-ptpp', 'dirjen-ptpp-sub1')).toBe(true);
    });

    it('admin_sesditjen should access sesditjen sub-units', () => {
        expect(canAccessUnit('admin_sesditjen', 'sesditjen-umum', 'sesditjen-umum')).toBe(true);
        expect(canAccessUnit('admin_sesditjen', 'sesditjen-umum', 'sesditjen-keuangan')).toBe(true);
    });
});

describe('isReadOnlyRole', () => {
    it('auditor should be read-only', () => {
        expect(isReadOnlyRole('auditor')).toBe(true);
    });

    it('user should be read-only', () => {
        expect(isReadOnlyRole('user')).toBe(true);
    });

    it('admin roles should NOT be read-only', () => {
        expect(isReadOnlyRole('super_admin')).toBe(false);
        expect(isReadOnlyRole('admin_dirjen')).toBe(false);
        expect(isReadOnlyRole('admin_sesditjen')).toBe(false);
    });
});

describe('getAllowedActions', () => {
    it('super_admin should have all actions on arsip', () => {
        const actions = getAllowedActions('super_admin', 'arsip');
        expect(actions).toContain('read');
        expect(actions).toContain('create');
        expect(actions).toContain('update');
        expect(actions).toContain('delete');
        expect(actions).toContain('destroy');
        expect(actions).toContain('export');
    });

    it('auditor should only have read and export on audit_log', () => {
        const actions = getAllowedActions('auditor', 'audit_log');
        expect(actions).toEqual(['read']);
    });

    it('should return empty array for non-existent module', () => {
        const actions = getAllowedActions('super_admin', 'non_existent' as Module);
        expect(actions).toEqual([]);
    });
});

describe('ROLE_HIERARCHY', () => {
    it('should have correct hierarchy order', () => {
        expect(ROLE_HIERARCHY['super_admin']).toBeGreaterThan(ROLE_HIERARCHY['admin_dirjen']);
        expect(ROLE_HIERARCHY['admin_dirjen']).toBeGreaterThan(ROLE_HIERARCHY['admin_sesditjen']);
        expect(ROLE_HIERARCHY['admin_sesditjen']).toBeGreaterThan(ROLE_HIERARCHY['auditor']);
        expect(ROLE_HIERARCHY['auditor']).toBeGreaterThan(ROLE_HIERARCHY['user']);
    });
});

// ── Role Middleware Tests ────────────────────────────────────────────────────

// Import middleware after setting up the environment
const { permissionMiddleware, canWriteMiddleware, canReadMiddleware } = await import('../middlewares/role.middleware');

function createMockReq(user?: Partial<AuthRequest['user']>): AuthRequest {
    return {
        user: user ? {
            id: user.id || 'test-id',
            email: user.email || 'test@atrbpn.go.id',
            name: user.name || 'Test User',
            role: user.role || 'user',
            unitKerjaId: user.unitKerjaId || null,
        } : undefined,
    } as AuthRequest;
}

function createMockRes(): Response {
    const res: Partial<Response> = {
        status: vi.fn().mockReturnThis() as any,
        json: vi.fn().mockReturnThis() as any,
        headersSent: false,
    };
    return res as Response;
}

describe('permissionMiddleware', () => {
    it('should allow super_admin to create surat_masuk', () => {
        const middleware = permissionMiddleware('surat_masuk', 'create');
        const req = createMockReq({ role: 'super_admin' });
        const res = createMockRes();
        const next = vi.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('should deny user from creating surat_masuk', () => {
        const middleware = permissionMiddleware('surat_masuk', 'create');
        const req = createMockReq({ role: 'user' });
        const res = createMockRes();
        const next = vi.fn();

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when user is not authenticated', () => {
        const middleware = permissionMiddleware('surat_masuk', 'read');
        const req = createMockReq(); // no user
        req.user = undefined;
        const res = createMockRes();
        const next = vi.fn();

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
    });
});

describe('canWriteMiddleware', () => {
    it('should allow admin_dirjen to write', () => {
        const middleware = canWriteMiddleware();
        const req = createMockReq({ role: 'admin_dirjen' });
        const res = createMockRes();
        const next = vi.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('should block auditor from writing', () => {
        const middleware = canWriteMiddleware();
        const req = createMockReq({ role: 'auditor' });
        const res = createMockRes();
        const next = vi.fn();

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('should block regular user from writing', () => {
        const middleware = canWriteMiddleware();
        const req = createMockReq({ role: 'user' });
        const res = createMockRes();
        const next = vi.fn();

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
    });
});

describe('canReadMiddleware', () => {
    it('should allow any authenticated user to read', () => {
        const middleware = canReadMiddleware();
        const req = createMockReq({ role: 'user' });
        const res = createMockRes();
        const next = vi.fn();

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('should return 401 when not authenticated', () => {
        const middleware = canReadMiddleware();
        const req = createMockReq();
        req.user = undefined;
        const res = createMockRes();
        const next = vi.fn();

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
    });
});
