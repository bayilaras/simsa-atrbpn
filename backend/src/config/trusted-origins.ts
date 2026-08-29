import { env } from './env';

/**
 * The single allow-list of browser origins that may call this API.
 *
 * CORS and the Better Auth origin guard both read from here, so a frontend can
 * never be allowed by one and rejected by the other.
 */
function normalize(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
        return new URL(trimmed).origin;
    } catch {
        return null;
    }
}

export function getTrustedOrigins(): string[] {
    const origins = [env.FRONTEND_URL, ...env.ADDITIONAL_TRUSTED_ORIGINS.split(',')]
        .map(normalize)
        .filter((o): o is string => o !== null);

    if (env.NODE_ENV !== 'production') {
        origins.push('http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173');
    }

    return [...new Set(origins)];
}

export function isTrustedOrigin(origin: string | undefined | null): boolean {
    if (!origin) return false;
    const candidate = normalize(origin);
    if (!candidate) return false;
    // Preview aliases must be configured explicitly. Trusting every
    // *.vercel.app sibling would let an unrelated Vercel site read credentialed
    // responses from a SIMSA Preview through the frontend's same-origin proxy.
    return getTrustedOrigins().includes(candidate);
}
