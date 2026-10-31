import { describe, expect, it, vi } from 'vitest';
import { buildEmailConfig } from '../config/email.js';

const mail = vi.hoisted(() => {
    const sendMail = vi.fn(async () => ({ messageId: 'synthetic-message' }));
    return { sendMail, createTransport: vi.fn(() => ({ sendMail })) };
});

vi.mock('nodemailer', () => ({
    default: { createTransport: mail.createTransport },
}));

const { EmailService } = await import('../services/email.service.js');

describe('EmailService SMTP timeout wiring', () => {
    it('passes the bounded timeout to every SMTP wait phase', async () => {
        const config = buildEmailConfig({
            SMTP_HOST: 'smtp.example.test',
            SMTP_PORT: '587',
            SMTP_USER: 'mailer',
            SMTP_PASS: 'secret-value',
            SMTP_FROM: 'simsa@example.test',
            SMTP_TIMEOUT_MS: '12000',
        });

        const service = new EmailService(config);
        // The transport is created on the first send, not when the service is built.
        expect(mail.createTransport).not.toHaveBeenCalled();

        const message = { to: 'staff@example.test', subject: 'Uji', text: 'Uji' };
        await expect(service.sendEmail(message)).resolves.toEqual({
            sent: true, status: 'sent', messageId: 'synthetic-message',
        });
        await service.sendEmail(message);

        expect(mail.createTransport).toHaveBeenCalledTimes(1);
        expect(mail.createTransport).toHaveBeenCalledWith(expect.objectContaining({
            connectionTimeout: 12000,
            greetingTimeout: 12000,
            socketTimeout: 12000,
        }));
        expect(mail.sendMail).toHaveBeenCalledTimes(2);
    });
});
