import { createHash } from 'node:crypto';

/** Stable seal of the JSON value persisted in JSONB, independent of key order. */
export function hashEvidenceSnapshot(snapshot: unknown): string {
    // Match JSONB input serialization first (Dates, omitted optional fields),
    // then sort object keys. Array order remains part of the evidence.
    const serialized = JSON.stringify(snapshot);
    if (serialized === undefined) throw new TypeError('Evidence must be a JSON value');
    const normalized: unknown = JSON.parse(serialized);
    const canonical = (value: unknown): string => {
        if (value === null || typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
        const object = value as Record<string, unknown>;
        return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
    };
    return createHash('sha256').update(canonical(normalized), 'utf8').digest('hex');
}
