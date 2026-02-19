import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './database';
import { env } from './env';
import * as schema from '../db/schema';

export const auth = betterAuth({
    baseURL: env.BETTER_AUTH_URL || 'http://localhost:3001',
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
