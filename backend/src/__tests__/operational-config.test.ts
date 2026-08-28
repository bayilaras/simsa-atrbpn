import { describe, expect, it, vi } from 'vitest';
import {
    assertValidBlobStorageEnvironment,
    buildBlobStorageConfig,
    getBlobStorageConfigurationStatus,
} from '../config/blob-storage.js';
import { buildEmailConfig, getEmailConfigurationStatus } from '../config/email.js';
import { EmailService, escapeEmailHtml } from '../services/email.service.js';

describe('operational integration configuration', () => {
    it('fails production startup when canonical private Blob is unavailable', () => {
        expect(() => assertValidBlobStorageEnvironment({ NODE_ENV: 'production' }))
            .toThrow(/BLOB_READ_WRITE_TOKEN/);
        const status = getBlobStorageConfigurationStatus(buildBlobStorageConfig({
            NODE_ENV: 'production',
            BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test_token_value',
            VERCEL_BLOB_CALLBACK_URL: 'https://api.example.go.id',
        }));
        expect(status).toMatchObject({
            required: true,
            configured: true,
            callbackRequired: true,
            callbackConfigured: true,
            ready: true,
        });
    });

    it('requires an origin-only Blob callback for production APIs outside Vercel', () => {
        const missing = buildBlobStorageConfig({
            NODE_ENV: 'production',
            BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test_token_value',
        });
        expect(missing).toMatchObject({ callbackRequired: true, callbackConfigured: false, ready: false });
        expect(missing.validationErrors.join(' ')).toContain('VERCEL_BLOB_CALLBACK_URL');

        for (const callbackUrl of [
            'http://api.example.go.id',
            'https://user:pass@api.example.go.id',
            'https://api.example.go.id/',
            'https://api.example.go.id/api/client-upload',
            'https://api.example.go.id?target=upload',
            'https://api.example.go.id#upload',
        ]) {
            const invalid = buildBlobStorageConfig({
                NODE_ENV: 'production',
                BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test_token_value',
                VERCEL_BLOB_CALLBACK_URL: callbackUrl,
            });
            expect(invalid.ready, callbackUrl).toBe(false);
            expect(invalid.validationErrors.join(' '), callbackUrl)
                .toMatch(/HTTPS origin/);
        }

        expect(buildBlobStorageConfig({
            NODE_ENV: 'production',
            VERCEL: '1',
            BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test_token_value',
        })).toMatchObject({ callbackRequired: false, callbackConfigured: false, ready: true });

        expect(buildBlobStorageConfig({
            NODE_ENV: 'production',
            BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_worker_test_value',
        }, { requireCallbackUrl: false })).toMatchObject({
            callbackRequired: false,
            callbackConfigured: false,
            ready: true,
        });
    });

    it('reports partial SMTP configuration as invalid without exposing credentials', () => {
        const status = getEmailConfigurationStatus(buildEmailConfig({
            SMTP_HOST: 'smtp.example.test',
            SMTP_USER: 'mailer',
        }));
        expect(status).toMatchObject({ configured: false, ready: false, mode: 'disabled' });
        expect(status.validationErrors.join(' ')).toContain('SMTP_PASS');
        expect(JSON.stringify(status)).not.toContain('mailer');
    });

    it('bounds SMTP network waits used by approval requests', () => {
        expect(buildEmailConfig({
            SMTP_HOST: 'smtp.example.test',
            SMTP_USER: 'mailer',
            SMTP_PASS: 'secret-value',
            SMTP_FROM: 'simsa@example.test',
            SMTP_TIMEOUT_MS: '15000',
        })).toMatchObject({ ready: true, timeoutMs: 15000 });
        expect(buildEmailConfig({ SMTP_TIMEOUT_MS: '60000' }).validationErrors.join(' '))
            .toContain('SMTP_TIMEOUT_MS');
    });

    it('returns not_configured instead of claiming an unsent email succeeded', async () => {
        const service = new EmailService(buildEmailConfig({}));
        await expect(service.sendEmail({
            to: 'recipient@example.test',
            subject: 'Test',
            text: 'Test',
        })).resolves.toMatchObject({
            sent: false,
            status: 'not_configured',
        });
    });

    it('escapes every user-controlled approval value before HTML rendering', async () => {
        const service = new EmailService(buildEmailConfig({}));
        const sendSpy = vi.spyOn(service, 'sendEmail').mockResolvedValue({
            sent: true,
            status: 'sent',
        });

        await service.sendApprovalNotification(
            'recipient@example.test',
            'SK-1</strong><img src=x onerror=alert(1)>',
            '<script>alert(1)</script>',
            'https://simsa.example.test/surat/keluar/1?x=1&y=2',
        );

        const html = sendSpy.mock.calls[0][0].html || '';
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('&amp;y=2');
        expect(escapeEmailHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    });

    it('rejects non-HTTP approval action links', async () => {
        const service = new EmailService(buildEmailConfig({}));
        await expect(service.sendApprovalNotification(
            'recipient@example.test', 'SK-1', 'Pemohon', 'javascript:alert(1)',
        )).rejects.toThrow('HTTP(S)');
    });
});
