import nodemailer from 'nodemailer';
import { createLogger } from '../utils/logger';

const log = createLogger('EmailService');

interface EmailOptions {
    to: string;
    subject: string;
    text: string;
    html?: string;
}

class EmailService {
    private transporter: nodemailer.Transporter | null = null;

    constructor() {
        // Initialize transporter if env vars are present, otherwise use stub
        if (process.env.SMTP_HOST && process.env.SMTP_USER) {
            this.transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT) || 587,
                secure: process.env.SMTP_SECURE === 'true',
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
            });
        } else {
            log.info('SMTP not configured, using stub mode');
        }
    }

    async sendEmail(options: EmailOptions): Promise<boolean> {
        if (!this.transporter) {
            log.debug({ to: options.to, subject: options.subject }, 'Email stub: message not sent (no SMTP)');
            return true;
        }

        try {
            await this.transporter.sendMail({
                from: process.env.SMTP_FROM || 'noreply@simsa.atrbpn.go.id',
                to: options.to,
                subject: options.subject,
                text: options.text,
                html: options.html,
            });
            return true;
        } catch (error) {
            log.error({ err: error }, 'Failed to send email');
            return false;
        }
    }

    async sendApprovalNotification(to: string, suratNomor: string, requesterName: string, link: string) {
        return this.sendEmail({
            to,
            subject: `[SIMSA] Permohonan Review Surat: ${suratNomor}`,
            text: `Halo,\n\n${requesterName} telah mengajukan surat dengan nomor ${suratNomor} untuk Anda review.\n\nSilakan klik link berikut untuk melihat detail:\n${link}\n\nTerima kasih.`,
            html: `
                <h3>Permohonan Review Surat</h3>
                <p>Halo,</p>
                <p><strong>${requesterName}</strong> telah mengajukan surat dengan nomor <strong>${suratNomor}</strong> untuk Anda review.</p>
                <p>Silakan klik tombol di bawah ini untuk melihat detail:</p>
                <a href="${link}" style="background-color: #059669; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Review Surat</a>
                <br><br>
                <p>Terima kasih.</p>
            `
        });
    }
}

export const emailService = new EmailService();
