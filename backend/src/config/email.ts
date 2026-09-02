export interface EmailConfig {
    configured: boolean;
    ready: boolean;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    from: string;
    timeoutMs: number;
    validationErrors: string[];
}

const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function buildEmailConfig(source: NodeJS.ProcessEnv = process.env): EmailConfig {
    const host = source.SMTP_HOST?.trim() || '';
    const user = source.SMTP_USER?.trim() || '';
    const password = source.SMTP_PASS || '';
    const from = source.SMTP_FROM?.trim() || '';
    const anyConfigured = Boolean(host || user || password || from || source.SMTP_PORT);
    const errors: string[] = [];
    const portRaw = source.SMTP_PORT?.trim() || '587';
    const port = Number(portRaw);
    const timeoutRaw = source.SMTP_TIMEOUT_MS?.trim() || '10000';
    const timeoutMs = Number(timeoutRaw);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push('SMTP_PORT must be an integer between 1 and 65535');
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
        errors.push('SMTP_TIMEOUT_MS must be an integer between 1000 and 30000');
    }
    if (anyConfigured) {
        const missing = [
            ['SMTP_HOST', host],
            ['SMTP_USER', user],
            ['SMTP_PASS', password],
            ['SMTP_FROM', from],
        ].filter(([, value]) => !value).map(([name]) => name);
        if (missing.length > 0) errors.push(`Missing SMTP settings: ${missing.join(', ')}`);
        if (from && !SIMPLE_EMAIL_PATTERN.test(from)) errors.push('SMTP_FROM must be an email address');
        if ([host, user, password, from].some(value => /\r|\n/.test(value))) {
            errors.push('SMTP settings must not contain line breaks');
        }
    }

    const configured = anyConfigured
        && Boolean(host && user && password && from)
        && Number.isInteger(port)
        && port >= 1
        && port <= 65535;
    return {
        configured,
        ready: configured && errors.length === 0,
        host,
        port: Number.isInteger(port) ? port : 587,
        secure: source.SMTP_SECURE?.trim().toLowerCase() === 'true',
        user,
        password,
        from,
        timeoutMs: Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 30000
            ? timeoutMs
            : 10000,
        validationErrors: errors,
    };
}

export function getEmailConfigurationStatus(config: EmailConfig = buildEmailConfig()) {
    return {
        mode: config.ready ? 'smtp' as const : 'disabled' as const,
        configured: config.configured,
        ready: config.ready,
        validationErrors: [...config.validationErrors],
    };
}
