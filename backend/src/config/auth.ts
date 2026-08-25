import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { db } from './database';
import { env } from './env';
import { getTrustedOrigins, isTrustedOrigin } from './trusted-origins';
import * as schema from '../db/schema';

// Determine the base URL for Better Auth:
// 1. Use BETTER_AUTH_URL if explicitly set (and not localhost in production)
// 2. Fall back to VERCEL_URL (auto-set by Vercel) in production
// 3. Default to localhost for local development
function resolveBaseURL(): string {
    const configured = env.BETTER_AUTH_URL;
    if (configured && !configured.includes('localhost')) {
        return configured;
    }
    // In production, try Vercel's auto-set URL
    if (env.NODE_ENV === 'production' && process.env.VERCEL_URL) {
        const url = `https://${process.env.VERCEL_URL}`;
        console.warn(`[Auth] BETTER_AUTH_URL not set for production. Using VERCEL_URL: ${url}`);
        return url;
    }
    if (env.NODE_ENV === 'production' && configured?.includes('localhost')) {
        console.error('[Auth] CRITICAL: BETTER_AUTH_URL points to localhost in production! Google OAuth will fail.');
    }
    return configured || 'http://localhost:3001';
}

// This origin guard is an additional boundary around Better Auth's built-in
// state-cookie, PKCE and CSRF protections.
// A browser always sends Origin (or at least Referer) on a cross-site POST, so rejecting
// untrusted origins blocks login/sign-out CSRF, while origin-less traffic (OAuth redirects,
// server-to-server calls through the proxy) keeps working as before.
const originGuard = createAuthMiddleware(async (ctx) => {
    const request = ctx.request;
    if (!request) return;

    const method = request.method?.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

    const originHeader = request.headers.get('origin') || request.headers.get('referer');
    if (!originHeader) return;

    if (!isTrustedOrigin(originHeader)) {
        ctx.context.logger.error(`Blocked auth request from untrusted origin: ${originHeader}`);
        throw new APIError('FORBIDDEN', { message: 'Invalid origin' });
    }
});

export const auth = betterAuth({
    baseURL: resolveBaseURL(),
    basePath: '/api/auth',
    database: drizzleAdapter(db, {
        provider: 'pg',
        usePlural: true,
    }),
    emailAndPassword: {
        enabled: true,
        // Production accounts are provisioned by an administrator. Existing
        // credential accounts may still sign in, but the public sign-up endpoint
        // cannot create unmanaged government-system users.
        disableSignUp: env.NODE_ENV === 'production',
        autoSignIn: true,
    },
    socialProviders: {
        google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
    },
    trustedOrigins: getTrustedOrigins(),
    session: {
        expiresIn: 60 * 60 * 24, // 24 hours — hardened for government document security
        updateAge: 60 * 60 * 4,  // 4 hours — refresh session more frequently
    },
    user: {
        additionalFields: {
            role: {
                type: 'string',
                defaultValue: 'user',
                required: false,
                // Role assignment is exclusively handled by the protected admin
                // user-management API. Without this flag Better Auth accepts the
                // additional field from sign-up/update-user payloads, allowing a
                // client to request `super_admin` for itself.
                input: false,
            },
        },
    },
    hooks: {
        before: originGuard,
    },
    advanced: {
        useSecureCookies: env.NODE_ENV === 'production',
        // Keep the library's state/CSRF validation enabled. Production must use
        // a same-site custom frontend/API domain; weakening OAuth state checking
        // to accommodate separate *.vercel.app hosts is not acceptable here.
        disableCSRFCheck: false,
        defaultCookieAttributes: env.NODE_ENV === 'production'
            ? {
                // Production is intentionally constrained to a same-site custom
                // frontend/API domain. Lax preserves top-level OAuth callbacks
                // while refusing cross-site subresource requests.
                sameSite: 'lax' as const,
                secure: true,
            }
            : {},
        crossSubDomainCookies: env.COOKIE_DOMAIN
            ? { enabled: true, domain: env.COOKIE_DOMAIN }
            : undefined,
        database: {
            generateId: 'uuid', // Use UUID for PostgreSQL
        },
    },
    logger: {
        level: env.NODE_ENV === 'production' ? 'error' : 'debug',
    },
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
