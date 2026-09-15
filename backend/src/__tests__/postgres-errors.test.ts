import { describe, expect, it } from 'vitest';
import { hasPostgresErrorCode } from '../utils/postgres-errors';

describe('PostgreSQL error classification', () => {
    it('recognizes a native driver error and a nested Drizzle cause', () => {
        const native = Object.assign(new Error('private database detail'), {
            code: '23505', constraint: 'expected_unique_idx',
        });
        const wrapped = new Error('query wrapper', { cause: new Error('driver wrapper', { cause: native }) });
        expect(hasPostgresErrorCode(native, '23505')).toBe(true);
        expect(hasPostgresErrorCode(wrapped, '23505', 'expected_unique_idx')).toBe(true);
    });

    it('does not misclassify another constraint or SQLSTATE', () => {
        const error = { code: '23505', constraint: 'audit_log_pkey' };
        expect(hasPostgresErrorCode(error, '23505', 'storage_locations_unit_code_unique_idx')).toBe(false);
        expect(hasPostgresErrorCode(error, '23514')).toBe(false);
        expect(hasPostgresErrorCode({ code: '23505' }, '23505', 'required_constraint')).toBe(false);
    });

    it('never treats text containing SQLSTATE as a structured error', () => {
        expect(hasPostgresErrorCode(new Error('23505 unique violation'), '23505')).toBe(false);
    });

    it.each([null, undefined, '23505', 23505])('handles primitive thrown values: %s', error => {
        expect(hasPostgresErrorCode(error, '23505')).toBe(false);
    });

    it('terminates on cyclic causes and hostile getters', () => {
        const cyclic: { cause?: unknown } = {};
        cyclic.cause = cyclic;
        expect(hasPostgresErrorCode(cyclic, '23505')).toBe(false);
        expect(hasPostgresErrorCode({ get code() { throw new Error('getter'); } }, '23505')).toBe(false);
        expect(hasPostgresErrorCode({ get cause() { throw new Error('getter'); } }, '23505')).toBe(false);
    });
});
