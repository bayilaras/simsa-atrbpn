import { describe, expect, it, vi } from 'vitest';
import { buildEmailConfig } from '../config/email.js';

const mail = vi.hoisted(() => ({
    createTransport: vi.fn(() => ({ sendMail: vi.fn() })),
}));

vi.mock('nodemailer', () => ({
    default: { createTransport: mail.createTransport },
}));

const { EmailService } = await import('../services/email.service.js');

describe('EmailService SMTP timeout wiring', () => {
    it('passes the bounded timeout to every SMTP wait phase', () => {
        const config = buildEmailConfig({
            SMTP_HOST: 'smtp.example.test',
            SMTP_PORT: '587',
            SMTP_USER: 'mailer',
            SMTP_PASS: 'secret-value',
            SMTP_FROM: 'simsa@example.test',
            SMTP_TIMEOUT_MS: '12000',
        });

        new EmailService(config);

        expect(mail.createTransport).toHaveBeenCalledWith(expect.objectContaining({
            connectionTimeout: 12000,
            greetingTimeout: 12000,
            socketTimeout: 12000,
        }));
    });
});
