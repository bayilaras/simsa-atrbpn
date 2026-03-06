import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './database';
import { env } from './env';
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

export const auth = betterAuth({
    baseURL: resolveBaseURL(),
    basePath: '/api/auth',
    database: drizzleAdapter(db, {
        provider: 'pg',
        usePlural: true,
    }),
    emailAndPassword: {
        enabled: true, // Enable email/password for testing
        autoSignIn: true,
    },
    socialProviders: {
        google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
    },
    account: {
        // TEMP FIX: .vercel.app is a public suffix — browsers can't share cookies
        // across subdomains (simsa-frontend.vercel.app ↔ simsa-backend.vercel.app).
        // This causes state_mismatch on OAuth callback.
        // Permanent fix: use custom domain (e.g., api.simsa.atrbpn.go.id).
        skipStateCookieCheck: true,
    },
    trustedOrigins: env.NODE_ENV === 'production'
        ? [env.FRONTEND_URL]
        : [env.FRONTEND_URL, 'http://localhost:3000', 'http://localhost:3001'],
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
            },
        },
    },
    advanced: {
        useSecureCookies: env.NODE_ENV === 'production',
        disableCSRFCheck: true, // We have our own CSRF middleware; Better Auth's check conflicts with Vercel proxy
        defaultCookieAttributes: env.NODE_ENV === 'production'
            ? {
                sameSite: 'none' as const,   // Required for cross-domain cookies on .vercel.app (public suffix)
                secure: true,
                partitioned: true,           // Required by modern browsers for third-party cookies
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
