import nodemailer from 'nodemailer';
import { createLogger } from '../utils/logger';
import {
    buildEmailConfig,
    getEmailConfigurationStatus,
    type EmailConfig,
} from '../config/email.js';

const log = createLogger('EmailService');

const HTML_ENTITIES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

export function escapeEmailHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => HTML_ENTITIES[character]);
}

function assertSafeEmailLink(value: string): string {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error('Email action link must be an absolute URL');
    }
    if (
        !['http:', 'https:'].includes(parsed.protocol)
        || parsed.username
        || parsed.password
    ) {
        throw new Error('Email action link must use HTTP(S) without embedded credentials');
    }
    return parsed.toString();
}

export interface EmailOptions {
    to: string;
    subject: string;
    text: string;
    html?: string;
}

export type EmailDeliveryResult =
    | { sent: true; status: 'sent'; messageId?: string }
    | { sent: false; status: 'not_configured' | 'failed'; error: string };

export class EmailService {
    private transporter: nodemailer.Transporter | null = null;

    constructor(private readonly config: EmailConfig = buildEmailConfig()) {
        if (config.ready) {
            this.transporter = nodemailer.createTransport({
                host: config.host,
                port: config.port,
                secure: config.secure,
                auth: {
                    user: config.user,
                    pass: config.password,
                },
                connectionTimeout: config.timeoutMs,
                greetingTimeout: config.timeoutMs,
                socketTimeout: config.timeoutMs,
            });
        } else {
            log.info({
                status: getEmailConfigurationStatus(config),
            }, 'SMTP unavailable; email delivery is disabled');
        }
    }

    getConfigurationStatus() {
        return getEmailConfigurationStatus(this.config);
    }

    async sendEmail(options: EmailOptions): Promise<EmailDeliveryResult> {
        if (!this.transporter) {
            log.warn({ to: options.to, subject: options.subject }, 'Email not sent: SMTP is not configured');
            return {
                sent: false,
                status: 'not_configured',
                error: this.config.validationErrors[0] || 'SMTP is not configured',
            };
        }

        try {
            const info = await this.transporter.sendMail({
                from: this.config.from,
                to: options.to,
                subject: options.subject,
                text: options.text,
                html: options.html,
            });
            return { sent: true, status: 'sent', messageId: info.messageId };
        } catch (error) {
            log.error({ err: error }, 'Failed to send email');
            return {
                sent: false,
                status: 'failed',
                error: error instanceof Error ? error.message : 'Email delivery failed',
            };
        }
    }

    async sendApprovalNotification(to: string, suratNomor: string, requesterName: string, link: string) {
        const safeLink = assertSafeEmailLink(link);
        const safeRequesterName = escapeEmailHtml(requesterName);
        const safeSuratNomor = escapeEmailHtml(suratNomor);
        const safeLinkHtml = escapeEmailHtml(safeLink);
        const safeSubjectNomor = suratNomor.replace(/[\r\n]+/g, ' ').trim();
        return this.sendEmail({
            to,
            subject: `[SIMSA] Permohonan Review Surat: ${safeSubjectNomor}`,
            text: `Halo,\n\n${requesterName} telah mengajukan surat dengan nomor ${suratNomor} untuk Anda review.\n\nSilakan klik link berikut untuk melihat detail:\n${safeLink}\n\nTerima kasih.`,
            html: `
                <h3>Permohonan Review Surat</h3>
                <p>Halo,</p>
                <p><strong>${safeRequesterName}</strong> telah mengajukan surat dengan nomor <strong>${safeSuratNomor}</strong> untuk Anda review.</p>
                <p>Silakan klik tombol di bawah ini untuk melihat detail:</p>
                <a href="${safeLinkHtml}" style="background-color: #059669; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Review Surat</a>
                <br><br>
                <p>Terima kasih.</p>
            `
        });
    }
}

export const emailService = new EmailService();
