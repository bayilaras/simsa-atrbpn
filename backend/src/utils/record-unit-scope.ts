import { and, eq, type AnyColumn, type SQL } from 'drizzle-orm';
import type { AuthRequest } from '../middlewares/auth.middleware.js';
import { resolveUnitKerjaId } from './resolve-unit-kerja.js';

/**
 * Scope used by record-by-ID queries.
 *
 * `null` is deliberately reserved for super_admin and means all units. An empty
 * string is a fail-closed scope: unit IDs are non-empty foreign keys, so it can
 * never match a persisted record.
 */
export type RecordUnitScope = string | null;
export const NO_RECORD_UNIT_ACCESS = '';

export function resolveRecordUnitScope(req: AuthRequest): RecordUnitScope {
    if (req.user?.role === 'super_admin') {
        return null;
    }

    // Keep this explicit so future changes to the list resolver cannot silently
    // broaden by-ID access for auditors.
    if (req.user?.role === 'auditor') {
        return req.user.unitKerjaId || NO_RECORD_UNIT_ACCESS;
    }

    return resolveUnitKerjaId(req)
        || req.user?.unitKerjaId
        || NO_RECORD_UNIT_ACCESS;
}

/** Build a default-deny by-ID predicate shared by record services. */
export function scopedRecordByIdWhere(
    idColumn: AnyColumn,
    id: string,
    unitColumn: AnyColumn,
    unitScope: RecordUnitScope,
): SQL {
    const idCondition = eq(idColumn, id);

    if (unitScope === null) {
        return idCondition;
    }

    return and(idCondition, eq(unitColumn, unitScope))!;
}
