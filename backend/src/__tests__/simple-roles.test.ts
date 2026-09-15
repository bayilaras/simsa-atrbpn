import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ASSIGNABLE_ROLES, hasPermission, canAccessUnit, isNoAccessRole, isReadOnlyRole, type Role } from '../config/permissions';
import { resolveUnitKerjaId, resolveEffectiveUnitKerjaId } from '../utils/resolve-unit-kerja';
import { resolveRecordUnitScope, scopedRecordByIdWhere } from '../utils/record-unit-scope';
import { canWriteMiddleware, permissionMiddleware, roleMiddleware } from '../middlewares/role.middleware';
import { createUserSchema, updateUserSchema, listUsersSchema } from '../validations/user-management.validation';
import { users } from '../db/schema/users';

const request = (role: string, unit: string | null = 'unit-a', requested = 'unit-b') => ({
    user: { id: 'actor', role, unitKerjaId: unit }, query: { unitKerjaId: requested }, body: {}, params: {},
}) as any;
describe('simple roles and unit boundaries', () => {
    it('offers only super_admin and admin_unit for new assignment, while legacy accounts stay filterable', () => {
        expect(ASSIGNABLE_ROLES).toEqual(['super_admin', 'admin_unit']);
        for (const role of ['admin_dirjen', 'admin_sesditjen', 'staff', 'auditor', 'user']) {
            expect(listUsersSchema.safeParse({ role }).success).toBe(true);
            expect(createUserSchema.safeParse({ name: 'User', email: 'u@example.test', role, unitKerjaId: 'unit-a' }).success).toBe(false);
            expect(updateUserSchema.safeParse({ role }).success).toBe(false);
        }
        expect(updateUserSchema.safeParse({ jabatan: 'Staf lama' }).success).toBe(true);
    });
    it.each([null, undefined, '', '   '])('requires an assigned unit when creating admin_unit: %s', unitKerjaId => {
        expect(createUserSchema.safeParse({ name: 'User', email: 'u@example.test', role: 'admin_unit', unitKerjaId }).success).toBe(false);
    });
    it('grants operational CRUD without global account, master catalog or system privileges', () => {
        for (const module of ['surat_masuk', 'surat_keluar', 'arsip', 'arsip_vital', 'arsip_terjaga', 'dosir'] as const) {
            for (const action of ['read', 'create', 'update', 'delete'] as const) expect(hasPermission('admin_unit', module, action)).toBe(true);
        }
        for (const module of ['user_management', 'settings', 'klasifikasi'] as const) {
            for (const action of ['create', 'update', 'delete'] as const) expect(hasPermission('admin_unit', module, action)).toBe(false);
        }
        expect(hasPermission('admin_unit', 'arsip', 'destroy')).toBe(false);
    });
    it('never widens assigned admin scope with body/query parameters or unassigned accounts', () => {
        expect(resolveUnitKerjaId(request('admin_unit'))).toBe('unit-a');
        expect(resolveRecordUnitScope(request('admin_unit'))).toBe('unit-a');
        expect(canAccessUnit('admin_unit', 'unit-a', 'unit-a')).toBe(true);
        expect(canAccessUnit('admin_unit', 'unit-a', 'unit-b')).toBe(false);
        for (const unit of [null, '', '  ']) {
            expect(() => resolveUnitKerjaId(request('admin_unit', unit))).toThrow();
            expect(resolveRecordUnitScope(request('admin_unit', unit))).toBe('');
            expect(canAccessUnit('admin_unit', unit, 'unit-b')).toBe(false);
        }
    });
    it('keeps legacy fixed unit mandates and denies unknown or pending roles', () => {
        expect(resolveEffectiveUnitKerjaId('admin_dirjen', 'unit-b', 'unit-b')).toBe('ditjen');
        expect(resolveEffectiveUnitKerjaId('admin_sesditjen', null, 'ditjen')).toBe('sesditjen');
        for (const role of ['unknown', '__proto__', 'user']) {
            expect(() => resolveUnitKerjaId(request(role))).toThrow();
            expect(resolveRecordUnitScope(request(role))).toBe('');
            expect(canAccessUnit(role as Role, 'unit-a', 'unit-a')).toBe(false);
            expect(isNoAccessRole(role as Role)).toBe(true);
            expect(isReadOnlyRole(role as Role)).toBe(true);
        }
        expect(resolveRecordUnitScope(request('super_admin', null))).toBeNull();
    });
    it('binds by-ID SQL to assigned unit while super_admin alone may use an all-unit predicate', () => {
        const dialect = new PgDialect();
        const where = scopedRecordByIdWhere(users.id, 'record-b', users.unitKerjaId, resolveRecordUnitScope(request('admin_unit')));
        const query = dialect.sqlToQuery(where);
        expect(query.params).toEqual(['record-b', 'unit-a']);
        expect(query.sql).toContain('"unit_kerja_id"');
    });
    it('rejects unassigned admins at write, permission and legacy role middleware boundaries', () => {
        for (const middleware of [canWriteMiddleware(), permissionMiddleware('arsip', 'update'), roleMiddleware(['admin_unit'])]) {
            const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
            const next = vi.fn(); middleware(request('admin_unit', null), res, next);
            expect(res.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
        }
        const next = vi.fn(); canWriteMiddleware()(request('admin_unit'), {} as any, next); expect(next).toHaveBeenCalledOnce();
        for (const role of ['staff', 'auditor']) {
            const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
            canWriteMiddleware()(request(role), res, vi.fn()); expect(res.status).toHaveBeenCalledWith(403);
        }
    });
});
