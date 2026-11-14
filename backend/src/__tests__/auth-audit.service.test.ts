import { APIError } from 'better-auth/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const audit = vi.hoisted(() => ({ logActionOrThrow: vi.fn() }));
vi.mock('../services/audit-log.service.js', () => ({ default: audit, auditLogService: audit }));
vi.mock('../config/database', () => ({ db: {} }));

const { authAuditEntry, recordAuthEvent } = await import('../services/auth-audit.service');

const user = { id: '10000000-0000-4000-8000-0000000009c1', email: 'pegawai@example.test' };
const headers = new Headers({ 'x-simsa-client-ip': '198.51.100.23' });
const redirect = () => new APIError('FOUND', { message: 'Redirect' });

describe('auth audit entries', () => {
    beforeEach(() => { audit.logActionOrThrow.mockReset().mockResolvedValue(undefined); });

    it('records a Google sign-in that completes in the provider callback, whose answer is a redirect', () => {
        expect(authAuditEntry({
            path: '/callback/:id', headers, context: { returned: redirect(), newSession: { user } },
        })).toEqual({
            action: 'sign_in', entityType: 'user', entityId: user.id, userId: user.id, userEmail: user.email,
            ipAddress: '198.51.100.23', changes: { after: { metode: 'google' } },
        });
    });

    it('records a Google ID-token sign-in and ignores the start of the redirect flow', () => {
        expect(authAuditEntry({
            path: '/sign-in/social', headers, context: { returned: { redirect: false }, newSession: { user } },
        })).toMatchObject({ action: 'sign_in', userId: user.id, changes: { after: { metode: 'google' } } });
        expect(authAuditEntry({
            path: '/sign-in/social', headers, context: { returned: { url: 'https://accounts.google.com', redirect: true } },
        })).toBeNull();
    });

    it('does not record a refused Google callback or account linking without a new session', () => {
        expect(authAuditEntry({ path: '/callback/:id', headers, context: { returned: redirect() } })).toBeNull();
    });

    it('ignores session reads and other auth endpoints', () => {
        for (const path of ['/get-session', '/list-accounts', '/update-user', '/ok']) {
            expect(authAuditEntry({ path, headers, context: { returned: {}, session: { user } } })).toBeNull();
        }
    });

    it('leaves out a client address that is not an IP address', () => {
        const forged = new Headers({ 'x-simsa-client-ip': 'bukan-alamat' });
        expect(authAuditEntry({ path: '/sign-out', headers: forged, context: { returned: { success: true }, session: { user } } }))
            .toMatchObject({ action: 'sign_out', ipAddress: undefined });
    });

    it('keeps signing in when the audit entry cannot be written', async () => {
        audit.logActionOrThrow.mockImplementation(async () => { throw new Error('audit table unavailable'); });
        await expect(recordAuthEvent({
            path: '/sign-in/email', headers, body: { email: user.email }, context: { returned: {}, newSession: { user } },
        })).resolves.toBeUndefined();
        expect(audit.logActionOrThrow).toHaveBeenCalledOnce();
    });
});
