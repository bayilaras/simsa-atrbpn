import { z } from 'zod';
import { getSessionFromCtx, isAPIError } from 'better-auth/api';
import auditLogService, { type LogActionData } from './audit-log.service.js';
import { betterAuthClientIp } from '../middlewares/better-auth-ip.middleware.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('AuthAudit');

interface AuthEventUser {
    id: string;
    email: string;
}

/** The parts of a Better Auth hook context the audit entries are built from. */
export interface AuthEventContext {
    path?: string;
    body?: unknown;
    params?: Record<string, unknown>;
    headers?: Headers;
    request?: Request;
    context: {
        returned?: unknown;
        newSession?: { user: AuthEventUser } | null;
        session?: { user: AuthEventUser } | null;
    };
}

// Stored as the reason of a failed email sign-in; the code itself stays out
// of the staff-facing log.
const FAILED_SIGN_IN_REASONS: Record<string, string> = {
    INVALID_EMAIL_OR_PASSWORD: 'Email atau kata sandi salah',
    FAILED_TO_CREATE_SESSION: 'Akun tidak aktif atau sesi tidak dapat dibuat',
    INVALID_EMAIL: 'Format email tidak valid',
    PASSWORD_TOO_LONG: 'Kata sandi terlalu panjang',
};

const emailAddress = z.email().max(255);

/**
 * The address typed into a failed sign-in, only when it is a well-formed
 * email address: a password typed into the email field by mistake must never
 * reach the audit log.
 */
function attemptedEmail(body: unknown): string | undefined {
    const value = body && typeof body === 'object' ? (body as { email?: unknown }).email : undefined;
    if (typeof value !== 'string') return undefined;
    const email = value.trim().toLowerCase();
    return emailAddress.safeParse(email).success ? email : undefined;
}

function failureReason(returned: unknown): string {
    const code = isAPIError(returned) ? (returned as { body?: { code?: unknown } }).body?.code : undefined;
    return (typeof code === 'string' && FAILED_SIGN_IN_REASONS[code]) || 'Permintaan masuk ditolak';
}

function userEntry(
    action: 'sign_in' | 'sign_out' | 'change_password',
    user: AuthEventUser,
    ipAddress: string | undefined,
    changes?: LogActionData['changes'],
): LogActionData {
    return {
        action,
        entityType: 'user',
        entityId: user.id,
        userId: user.id,
        userEmail: user.email,
        ipAddress,
        ...(changes ? { changes } : {}),
    };
}

/**
 * Audit entry for a sign-in, a failed email sign-in, a sign-out or a change
 * of one's own password; null for every other auth request. Never includes a
 * password, token or session id.
 */
export function authAuditEntry(ctx: AuthEventContext): LogActionData | null {
    const path = ctx.path ?? '';
    const ipAddress = betterAuthClientIp(ctx.headers ?? ctx.request?.headers);
    const failed = isAPIError(ctx.context.returned);

    if (path === '/sign-in/email') {
        const user = ctx.context.newSession?.user;
        if (!failed && user) return userEntry('sign_in', user, ipAddress, { after: { metode: 'email' } });
        if (!failed) return null;
        return {
            action: 'sign_in_failed',
            entityType: 'user',
            userEmail: attemptedEmail(ctx.body),
            ipAddress,
            changes: { after: { metode: 'email', alasan: failureReason(ctx.context.returned) } },
        };
    }

    // An ID-token sign-in completes in /sign-in/social; the redirect flow
    // completes in the provider callback, whose answer is always a redirect.
    if (path === '/sign-in/social' || path.startsWith('/callback/')) {
        const user = ctx.context.newSession?.user;
        if (!user || (failed && path === '/sign-in/social')) return null;
        return userEntry('sign_in', user, ipAddress, { after: { metode: 'google' } });
    }

    if (path === '/sign-out') {
        const user = ctx.context.session?.user;
        return user && !failed ? userEntry('sign_out', user, ipAddress) : null;
    }

    if (path === '/change-password') {
        const user = ctx.context.newSession?.user ?? ctx.context.session?.user;
        if (!user || failed) return null;
        // The Audit Log shows the key as "kata sandi".
        return userEntry('change_password', user, ipAddress, {
            fields: ['kata_sandi'],
            after: { kata_sandi: 'diganti' },
        });
    }

    return null;
}

/**
 * Better Auth after-hook. Signing in and out keeps working when the audit
 * table cannot be written; the audit service logs and counts the failure.
 */
export async function recordAuthEvent(ctx: AuthEventContext): Promise<void> {
    const entry = authAuditEntry(ctx);
    if (!entry) return;
    try {
        await auditLogService.logActionOrThrow(entry);
    } catch {
        log.error({ event: 'auth_audit_failed', action: entry.action }, 'Authentication event was not audited');
    }
}

/**
 * Better Auth before-hook step: sign-out deletes the session, so who is
 * signing out is read before it runs and left in ctx.context.session.
 */
export async function rememberSigningOutUser(ctx: Parameters<typeof getSessionFromCtx>[0]): Promise<void> {
    if (ctx.path !== '/sign-out' || !ctx.request?.headers.has('cookie')) return;
    await getSessionFromCtx(ctx, { disableRefresh: true });
}
