import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware, APIError, getAuthoritativeSessionFromCtx } from 'better-auth/api';
import { db } from './database';
import { env } from './env';
import { getTrustedOrigins, isTrustedOrigin } from './trusted-origins';
import { hashCredentialPassword, verifyCredentialPassword } from './password-hashing.js';
import { buildGoogleOAuthConfig } from './google-oauth.js';
import { createRateLimiterStore, usesSharedRateLimits } from './rate-limits.js';
import { betterAuthIpOptions } from '../middlewares/better-auth-ip.middleware.js';
import * as schema from '../db/schema';
import { archiveAccessProvisioningIssue } from '../services/identity-user.service.js';

const deployedRuntime = usesSharedRateLimits();
const googleConfig = buildGoogleOAuthConfig();

// OAuth is served through the public frontend origin in production. Falling
// back to the backend's Vercel hostname would move the state cookie to a
// different origin and make the Google callback fail, so production must be
// configured explicitly and fails closed when it is not.
function resolveBaseURL(): string {
    const configured = env.BETTER_AUTH_URL;
    if (deployedRuntime) {
        if (!configured || configured.includes('localhost')) {
            throw new Error('BETTER_AUTH_URL must be the public frontend origin in production.');
        }
        let authOrigin: string;
        let frontendOrigin: string;
        try {
            authOrigin = new URL(configured).origin;
            frontendOrigin = new URL(env.FRONTEND_URL).origin;
        } catch {
            throw new Error('BETTER_AUTH_URL and FRONTEND_URL must be valid absolute URLs.');
        }
        if (authOrigin !== frontendOrigin) {
            throw new Error('BETTER_AUTH_URL must match the public FRONTEND_URL origin in production.');
        }
        return authOrigin;
    }
    return (configured || 'http://localhost:3001').replace(/\/+$/, '');
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
    const originHeader = request.headers.get('origin') || request.headers.get('referer');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method || '') && originHeader && !isTrustedOrigin(originHeader)) {
        ctx.context.logger.error(`Blocked auth request from untrusted origin: ${originHeader}`);
        throw new APIError('FORBIDDEN', { message: 'Invalid origin' });
    }

    // The native auth endpoints sit outside archive authMiddleware. Pending
    // and inactive sessions may inspect their identity or leave, but cannot
    // mutate profiles/accounts through that separate API surface.
    const identityPaths = ['/get-session', '/sign-out', '/ok', '/error'];
    if (identityPaths.includes(ctx.path) || ctx.path.startsWith('/sign-in/') || ctx.path.startsWith('/callback/')) return;
    if (!request.headers.has('cookie')) return;
    const current = await getAuthoritativeSessionFromCtx(ctx);
    if (current && (current.user.isActive === false || archiveAccessProvisioningIssue({
        role: String(current.user.role || 'user'),
        unitKerjaId: typeof current.user.unitKerjaId === 'string' ? current.user.unitKerjaId : null,
    }) !== null)) {
        throw new APIError('FORBIDDEN', { code: 'ACCESS_PENDING', message: 'Akun hanya dapat melihat status akses atau keluar. Hubungi administrator.' });
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
        password: {
            // Write only Better Auth's current scrypt format while retaining a
            // verification path for credential rows created by older bcrypt
            // seed/provisioning scripts.
            hash: hashCredentialPassword,
            verify: verifyCredentialPassword,
        },
        // Production accounts are provisioned by an administrator. Existing
        // credential accounts may still sign in, but the public sign-up endpoint
        // cannot create unmanaged government-system users.
        disableSignUp: deployedRuntime,
        autoSignIn: true,
    },
    // Do not register an OAuth provider when the operator explicitly disabled
    // it. Startup validates the opt-out; stale credentials cannot re-enable it.
    socialProviders: googleConfig.enabled ? {
        google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            // Opt-in permits identity creation only. Role/unit assignment is
            // forced to pending below and remains administrator-controlled.
            disableImplicitSignUp: !googleConfig.pendingSignupEnabled,
            disableSignUp: !googleConfig.pendingSignupEnabled,
        },
    } : {},
    account: {
        accountLinking: {
            enabled: true,
            // A passwordless account is provisioned by a SIMSA administrator
            // with an unverified local email. Permit linking only when the
            // provider itself returns the same verified email. Existing role
            // and unit assignments are never replaced during linking.
            requireLocalEmailVerified: false,
            allowDifferentEmails: false,
        },
    },
    trustedOrigins: getTrustedOrigins(),
    // Better Auth's per-endpoint burst policies share atomic counters too.
    // Express separately enforces the longer login-attempt window at admission.
    rateLimit: { enabled: deployedRuntime, customStorage: createRateLimiterStore('better-auth') },
    session: {
        expiresIn: 60 * 60 * 24, // 24 hours — hardened for government document security
        updateAge: 60 * 60 * 4,  // 4 hours — refresh session more frequently
    },
    user: {
        validateUserInfo: async ({ user, source }) => {
            if (source.method !== 'oauth') return;
            if (source.oauth?.providerId !== 'google' || user.emailVerified !== true) {
                return { error: 'GOOGLE_EMAIL_VERIFICATION_REQUIRED', errorDescription: 'Gunakan identitas Google dengan email terverifikasi.' };
            }
            if (source.action === 'create-user' && !googleConfig.pendingSignupEnabled) {
                return { error: 'GOOGLE_SIGNUP_DISABLED', errorDescription: 'Minta administrator memprovisikan akun Anda.' };
            }
        },
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
            unitKerjaId: {
                type: 'string',
                required: false,
                input: false,
            },
            isActive: {
                type: 'boolean',
                defaultValue: true,
                required: false,
                // Keep the session UI aligned with the fresh database check in
                // authMiddleware. Account activation remains administrator-only.
                input: false,
            },
        },
    },
    hooks: {
        before: originGuard,
    },
    databaseHooks: {
        user: {
            create: {
                // Applies only to new Better Auth rows. Administrator-provided
                // accounts use the protected domain API; linking never runs it.
                before: async (user) => ({ data: { ...user, role: 'user', unitKerjaId: null, isActive: true } }),
            },
        },
        session: {
            create: {
                before: async (session, context) => {
                    const user = await context?.context.internalAdapter.findUserById(session.userId);
                    return Boolean(user && (user as typeof user & { isActive?: boolean }).isActive !== false);
                },
            },
        },
    },
    advanced: {
        ipAddress: betterAuthIpOptions,
        useSecureCookies: deployedRuntime,
        // Keep the library's state/CSRF validation enabled. Production must use
        // a same-site custom frontend/API domain; weakening OAuth state checking
        // to accommodate separate *.vercel.app hosts is not acceptable here.
        disableCSRFCheck: false,
        defaultCookieAttributes: deployedRuntime
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
