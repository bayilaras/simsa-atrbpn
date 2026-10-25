/** Inspect structured PostgreSQL errors through driver/Drizzle wrappers without reading SQL text. */
export function hasPostgresErrorCode(
    error: unknown,
    code: string,
    constraintName?: string,
): boolean {
    const seen = new Set<object>();
    let current = error;
    for (let depth = 0; depth < 16; depth += 1) {
        if (!current || typeof current !== 'object' || seen.has(current)) return false;
        seen.add(current);
        try {
            const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
            if (candidate.code === code &&
                (constraintName === undefined || candidate.constraint === constraintName)) {
                return true;
            }
            current = candidate.cause;
        } catch {
            // An arbitrary thrown value can have unsafe property getters.
            return false;
        }
    }
    return false;
}
