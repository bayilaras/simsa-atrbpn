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

/**
 * Vercel preview deployments get a generated URL per branch, so they can never
 * match FRONTEND_URL. VERCEL_ENV is 'preview' only on those deployments — never
 * on production — so trusting sibling *.vercel.app origins here lets a PR be
 * reviewed end to end without loosening anything in production.
 */
function isVercelPreviewOrigin(origin: string): boolean {
    if (env.VERCEL_ENV !== 'preview') return false;
    try {
        const { protocol, hostname } = new URL(origin);
        return protocol === 'https:' && hostname.endsWith('.vercel.app');
    } catch {
        return false;
    }
}

export function isTrustedOrigin(origin: string | undefined | null): boolean {
    if (!origin) return false;
    const candidate = normalize(origin);
    if (!candidate) return false;
    return getTrustedOrigins().includes(candidate) || isVercelPreviewOrigin(candidate);
}
