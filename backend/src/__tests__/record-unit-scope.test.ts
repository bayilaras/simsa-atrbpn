import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthRequest } from '../middlewares/auth.middleware.js';
import { arsipVital } from '../db/schema/arsip-vital.js';
import {
    NO_RECORD_UNIT_ACCESS,
    resolveRecordUnitScope,
    scopedRecordByIdWhere,
} from '../utils/record-unit-scope.js';

function requestFor(
    role: string,
    unitKerjaId: string | null,
    queryUnitKerjaId?: string,
): AuthRequest {
    return {
        user: {
            id: 'user-1',
            email: 'user@example.test',
            name: 'Test User',
            role,
            unitKerjaId,
        },
        query: queryUnitKerjaId ? { unitKerjaId: queryUnitKerjaId } : {},
    } as unknown as AuthRequest;
}

describe('resolveRecordUnitScope', () => {
    it('uses null exclusively as the super_admin all-unit scope', () => {
        expect(resolveRecordUnitScope(requestFor('super_admin', null))).toBeNull();
        expect(resolveRecordUnitScope(requestFor('super_admin', 'u1', 'u2'))).toBeNull();
    });

    it('forces staff to their assigned unit and ignores a requested unit', () => {
        expect(resolveRecordUnitScope(requestFor('staff', 'u1', 'u2'))).toBe('u1');
    });

    it('does not let an auditor select another unit for a record endpoint', () => {
        expect(resolveRecordUnitScope(requestFor('auditor', 'u1', 'u2'))).toBe('u1');
    });

    it('fails closed when a non-super user has no effective unit', () => {
        expect(resolveRecordUnitScope(requestFor('staff', null))).toBe(NO_RECORD_UNIT_ACCESS);
        expect(resolveRecordUnitScope(requestFor('auditor', null, 'u2'))).toBe(NO_RECORD_UNIT_ACCESS);
    });

    it('retains the configured organisational scope for administrative roles', () => {
        expect(resolveRecordUnitScope(requestFor('admin_dirjen', null, 'u2'))).toBe('ditjen');
        expect(resolveRecordUnitScope(requestFor('admin_sesditjen', null, 'u2'))).toBe('sesditjen');
    });
});

describe('scopedRecordByIdWhere', () => {
    const dialect = new PgDialect();

    it('adds the unit predicate for an ordinary unit scope', () => {
        const query = dialect.sqlToQuery(scopedRecordByIdWhere(
            arsipVital.id,
            'record-1',
            arsipVital.unitKerjaId,
            'u1',
        ));

        expect(query.sql).toContain('"unit_kerja_id" = $2');
        expect(query.params).toEqual(['record-1', 'u1']);
    });

    it('keeps the fail-closed empty unit predicate', () => {
        const query = dialect.sqlToQuery(scopedRecordByIdWhere(
            arsipVital.id,
            'record-1',
            arsipVital.unitKerjaId,
            NO_RECORD_UNIT_ACCESS,
        ));

        expect(query.sql).toContain('"unit_kerja_id" = $2');
        expect(query.params).toEqual(['record-1', NO_RECORD_UNIT_ACCESS]);
    });

    it('omits the unit predicate only for the explicit super_admin scope', () => {
        const query = dialect.sqlToQuery(scopedRecordByIdWhere(
            arsipVital.id,
            'record-1',
            arsipVital.unitKerjaId,
            null,
        ));

        expect(query.sql).not.toContain('unit_kerja_id');
        expect(query.params).toEqual(['record-1']);
    });
});
