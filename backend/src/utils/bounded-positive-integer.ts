/**
 * Parse an optional query-string integer into [1, maximum]. Non-numeric input
 * falls back; out-of-range values are clamped instead of reaching a query.
 */
export function boundedPositiveInteger(value: unknown, fallback: number, maximum: number): number {
    if (typeof value !== 'string') return fallback;

    const normalized = value.trim();
    if (!/^-?\d+$/.test(normalized)) return fallback;

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return normalized.startsWith('-') ? 1 : maximum;
    return Math.min(maximum, Math.max(1, parsed));
}
