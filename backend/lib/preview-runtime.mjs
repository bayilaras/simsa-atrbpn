const PREVIEW_ENABLE_FLAG = 'SIMSA_PREVIEW_ENABLED';

const REQUIRED_PREVIEW_ENVIRONMENT = Object.freeze({
    DATABASE_URL: 'PREVIEW_DATABASE_URL',
    BLOB_READ_WRITE_TOKEN: 'PREVIEW_BLOB_READ_WRITE_TOKEN',
    BETTER_AUTH_SECRET: 'PREVIEW_BETTER_AUTH_SECRET',
    BETTER_AUTH_URL: 'PREVIEW_BETTER_AUTH_URL',
    FRONTEND_URL: 'PREVIEW_FRONTEND_URL',
    GOOGLE_CLIENT_ID: 'PREVIEW_GOOGLE_CLIENT_ID',
    GOOGLE_CLIENT_SECRET: 'PREVIEW_GOOGLE_CLIENT_SECRET',
    VERCEL_BLOB_CALLBACK_URL: 'PREVIEW_VERCEL_BLOB_CALLBACK_URL',
});

const OPTIONAL_PREVIEW_ENVIRONMENT = Object.freeze({
    ADDITIONAL_TRUSTED_ORIGINS: 'PREVIEW_ADDITIONAL_TRUSTED_ORIGINS',
    COOKIE_DOMAIN: 'PREVIEW_COOKIE_DOMAIN',
    OCR_TESSDATA_PATH: 'PREVIEW_OCR_TESSDATA_PATH',
    OCR_CACHE_PATH: 'PREVIEW_OCR_CACHE_PATH',
    SMTP_HOST: 'PREVIEW_SMTP_HOST',
    SMTP_PORT: 'PREVIEW_SMTP_PORT',
    SMTP_SECURE: 'PREVIEW_SMTP_SECURE',
    SMTP_USER: 'PREVIEW_SMTP_USER',
    SMTP_PASS: 'PREVIEW_SMTP_PASS',
    SMTP_FROM: 'PREVIEW_SMTP_FROM',
    SMTP_TIMEOUT_MS: 'PREVIEW_SMTP_TIMEOUT_MS',
    CLIENT_BLOB_UPLOAD_TTL_HOURS: 'PREVIEW_CLIENT_BLOB_UPLOAD_TTL_HOURS',
    CLIENT_BLOB_RECONCILE_BATCH_SIZE: 'PREVIEW_CLIENT_BLOB_RECONCILE_BATCH_SIZE',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'PREVIEW_GOOGLE_SERVICE_ACCOUNT_EMAIL',
    GOOGLE_PRIVATE_KEY: 'PREVIEW_GOOGLE_PRIVATE_KEY',
    GOOGLE_DRIVE_FOLDER_ID: 'PREVIEW_GOOGLE_DRIVE_FOLDER_ID',
});

const FORCED_PREVIEW_ENVIRONMENT = Object.freeze({
    APP_PROFILE: 'internal',
    SRIKANDI_ENABLED: 'false',
    SRIKANDI_PRODUCER_ENABLED: 'false',
    SRIKANDI_API_TOKEN: '',
    // Vercel Functions must never inherit a Production scanner host or worker
    // schedule. Preview remains quarantine-only until a separately deployed,
    // explicitly configured worker processes its isolated database.
    MALWARE_SCANNER_MODE: 'disabled',
    MALWARE_SCAN_WORKER_ENABLED: 'false',
    MALWARE_SCAN_WORKER_RUNTIME: 'external',
    CLAMAV_HOST: '',
    CLAMAV_PORT: '',
    CLAMAV_TRUSTED_NETWORK: 'false',
    CLAMAV_CONNECT_TIMEOUT_MS: '',
    CLAMAV_SCAN_TIMEOUT_MS: '',
    CLAMAV_MAX_STREAM_BYTES: '',
    MALWARE_SCAN_DOWNLOAD_TIMEOUT_MS: '',
    MALWARE_SCAN_INTERVAL_MS: '',
    MALWARE_SCAN_BATCH_SIZE: '',
    MALWARE_SCAN_STALE_AFTER_MS: '',
    MALWARE_SCAN_MAX_ATTEMPTS: '',
    MALWARE_SCAN_RETRY_BASE_MS: '',
    MALWARE_SCAN_RETRY_MAX_MS: '',
});

function requiresPreviewIsolationGate(environment) {
    const vercelMarker = environment.VERCEL?.trim() || '';
    const deploymentTarget = environment.VERCEL_ENV?.trim() || '';
    if (!vercelMarker && !deploymentTarget) return false;

    // Production is the only Vercel target allowed to consume the generic
    // resource names, and only when both system values are exact. Partial or
    // unexpected Vercel metadata must fail closed because otherwise a Preview
    // could be mistaken for Production.
    return vercelMarker !== '1' || deploymentTarget !== 'production';
}

function isExplicitlyEnabled(value) {
    return value?.trim().toLowerCase() === 'true';
}

function parseHttpsOrigin(name, value, errors) {
    try {
        const parsed = new URL(value);
        if (
            parsed.protocol !== 'https:'
            || parsed.username
            || parsed.password
            || (parsed.pathname !== '/' && parsed.pathname !== '')
            || parsed.search
            || parsed.hash
        ) {
            errors.push(`${name} must be an HTTPS origin`);
            return null;
        }
        return parsed.origin;
    } catch {
        errors.push(`${name} must be an HTTPS origin`);
        return null;
    }
}

function canonicalHttpsOrigin(value) {
    try {
        return new URL(value.trim()).origin;
    } catch {
        return value.trim();
    }
}

function canonicalPostgresTarget(value) {
    try {
        const parsed = new URL(value.trim());
        if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) return value.trim();
        const hostname = parsed.hostname.replace(/\.+$/, '').toLowerCase();
        const port = parsed.port || '5432';
        let databasePath = parsed.pathname;
        try {
            databasePath = decodeURIComponent(databasePath);
        } catch {
            // The required Preview URL validation reports malformed escapes.
        }
        return `${hostname}:${port}${databasePath}`;
    } catch {
        return value.trim();
    }
}

function validateInteger(environment, name, minimum, maximum, errors) {
    const raw = environment[name];
    if (!raw?.trim()) return;
    const normalized = raw.trim();
    if (raw !== normalized || !/^\d+$/.test(normalized)) {
        errors.push(`${name} must be an integer between ${minimum} and ${maximum}`);
        return;
    }
    const value = Number(normalized);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        errors.push(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
}

function validateOptionalPreviewEnvironment(environment, errors) {
    validateInteger(environment, 'PREVIEW_SMTP_PORT', 1, 65_535, errors);
    validateInteger(environment, 'PREVIEW_SMTP_TIMEOUT_MS', 1_000, 30_000, errors);
    validateInteger(environment, 'PREVIEW_CLIENT_BLOB_RECONCILE_BATCH_SIZE', 1, 200, errors);

    const ttlRaw = environment.PREVIEW_CLIENT_BLOB_UPLOAD_TTL_HOURS;
    if (ttlRaw?.trim()) {
        const normalized = ttlRaw.trim();
        const value = Number(normalized);
        if (ttlRaw !== normalized || !Number.isFinite(value) || value < 1 || value > 168) {
            errors.push('PREVIEW_CLIENT_BLOB_UPLOAD_TTL_HOURS must be between 1 and 168');
        }
    }

    const smtpSecure = environment.PREVIEW_SMTP_SECURE?.trim().toLowerCase();
    if (smtpSecure && !['true', 'false'].includes(smtpSecure)) {
        errors.push('PREVIEW_SMTP_SECURE must be either true or false');
    }

    const smtpNames = [
        'PREVIEW_SMTP_HOST',
        'PREVIEW_SMTP_USER',
        'PREVIEW_SMTP_PASS',
        'PREVIEW_SMTP_FROM',
    ];
    const smtpConfigured = [
        ...smtpNames,
        'PREVIEW_SMTP_PORT',
    ].some((name) => Boolean(environment[name]?.trim()));
    if (smtpConfigured) {
        const missingSmtp = smtpNames.filter((name) => !environment[name]?.trim());
        if (missingSmtp.length > 0) {
            errors.push(`Incomplete Preview SMTP configuration: ${missingSmtp.join(', ')}`);
        }
    }
    if (smtpNames.some((name) => /[\r\n]/.test(environment[name] || ''))) {
        errors.push('Preview SMTP settings must not contain line breaks');
    }
    const smtpFrom = environment.PREVIEW_SMTP_FROM?.trim();
    if (smtpFrom && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(smtpFrom)) {
        errors.push('PREVIEW_SMTP_FROM must be an email address');
    }
}

function validatePreviewEnvironment(environment, missing, compareInheritedProduction) {
    const errors = [];
    const isMissing = (name) => missing.includes(name);

    for (const previewName of Object.values(REQUIRED_PREVIEW_ENVIRONMENT)) {
        const value = environment[previewName];
        if (!isMissing(previewName) && value !== value.trim()) {
            errors.push(`${previewName} must not contain surrounding whitespace`);
        }
        if (!isMissing(previewName) && /[\r\n]/.test(value)) {
            errors.push(`${previewName} must not contain line breaks`);
        }
    }

    if (!isMissing('PREVIEW_DATABASE_URL')) {
        try {
            const database = new URL(environment.PREVIEW_DATABASE_URL);
            if (
                !['postgres:', 'postgresql:'].includes(database.protocol)
                || !database.hostname
                || !database.pathname
                || database.pathname === '/'
            ) {
                errors.push('PREVIEW_DATABASE_URL must identify a PostgreSQL database');
            }
        } catch {
            errors.push('PREVIEW_DATABASE_URL must identify a PostgreSQL database');
        }
    }

    const blobToken = environment.PREVIEW_BLOB_READ_WRITE_TOKEN || '';
    if (!isMissing('PREVIEW_BLOB_READ_WRITE_TOKEN')
        && (blobToken.length < 16 || /[\r\n]/.test(blobToken))) {
        errors.push('PREVIEW_BLOB_READ_WRITE_TOKEN has an invalid format');
    }
    if (!isMissing('PREVIEW_BETTER_AUTH_SECRET')
        && (environment.PREVIEW_BETTER_AUTH_SECRET || '').length < 32) {
        errors.push('PREVIEW_BETTER_AUTH_SECRET must be at least 32 characters');
    }
    if (!isMissing('PREVIEW_GOOGLE_CLIENT_SECRET')
        && (environment.PREVIEW_GOOGLE_CLIENT_SECRET || '').length < 16) {
        errors.push('PREVIEW_GOOGLE_CLIENT_SECRET has an invalid format');
    }

    const authOrigin = isMissing('PREVIEW_BETTER_AUTH_URL')
        ? null
        : parseHttpsOrigin('PREVIEW_BETTER_AUTH_URL', environment.PREVIEW_BETTER_AUTH_URL, errors);
    const frontendOrigin = isMissing('PREVIEW_FRONTEND_URL')
        ? null
        : parseHttpsOrigin('PREVIEW_FRONTEND_URL', environment.PREVIEW_FRONTEND_URL, errors);
    if (authOrigin && frontendOrigin && authOrigin !== frontendOrigin) {
        errors.push('PREVIEW_BETTER_AUTH_URL must match PREVIEW_FRONTEND_URL');
    }

    if (!isMissing('PREVIEW_VERCEL_BLOB_CALLBACK_URL')) {
        const callbackValue = environment.PREVIEW_VERCEL_BLOB_CALLBACK_URL;
        const callbackOrigin = parseHttpsOrigin(
            'PREVIEW_VERCEL_BLOB_CALLBACK_URL',
            callbackValue,
            errors,
        );
        if (callbackValue !== callbackValue.trim() || callbackValue.endsWith('/')) {
            errors.push('PREVIEW_VERCEL_BLOB_CALLBACK_URL must not have whitespace or a trailing slash');
        }
        if (callbackOrigin && new URL(callbackOrigin).hostname.toLowerCase().endsWith('.vercel.app')) {
            errors.push('PREVIEW_VERCEL_BLOB_CALLBACK_URL must not use a protected Vercel deployment');
        }
    }

    validateOptionalPreviewEnvironment(environment, errors);

    if (compareInheritedProduction) {
        // Separate names are not enough if an operator accidentally copies the
        // inherited Production values. Read those generic values only after the
        // explicit marker and complete PREVIEW_* contract are present.
        for (const [genericName, previewName, identity] of [
            ['DATABASE_URL', 'PREVIEW_DATABASE_URL', canonicalPostgresTarget],
            ['BLOB_READ_WRITE_TOKEN', 'PREVIEW_BLOB_READ_WRITE_TOKEN', String],
            ['BETTER_AUTH_SECRET', 'PREVIEW_BETTER_AUTH_SECRET', String],
            ['BETTER_AUTH_URL', 'PREVIEW_BETTER_AUTH_URL', canonicalHttpsOrigin],
            ['FRONTEND_URL', 'PREVIEW_FRONTEND_URL', canonicalHttpsOrigin],
            ['GOOGLE_CLIENT_ID', 'PREVIEW_GOOGLE_CLIENT_ID', String],
            ['GOOGLE_CLIENT_SECRET', 'PREVIEW_GOOGLE_CLIENT_SECRET', String],
            ['VERCEL_BLOB_CALLBACK_URL', 'PREVIEW_VERCEL_BLOB_CALLBACK_URL', canonicalHttpsOrigin],
        ]) {
            const genericValue = environment[genericName]?.trim();
            const previewValue = environment[previewName]?.trim();
            if (genericValue && previewValue && identity(genericValue) === identity(previewValue)) {
                errors.push(`${previewName} must differ from the inherited Production value`);
            }
        }
    }

    return errors;
}

export function inspectPreviewRuntime(environment = process.env) {
    if (!requiresPreviewIsolationGate(environment)) {
        return { gated: false, provisioned: true, missing: [] };
    }

    const missing = Object.values(REQUIRED_PREVIEW_ENVIRONMENT)
        .filter((name) => !environment[name]?.trim());
    const enabled = isExplicitlyEnabled(environment[PREVIEW_ENABLE_FLAG]);
    const validationErrors = validatePreviewEnvironment(
        environment,
        missing,
        enabled && missing.length === 0,
    );

    return {
        gated: true,
        provisioned: enabled && missing.length === 0 && validationErrors.length === 0,
        missing,
        validationErrors,
    };
}

export function activatePreviewEnvironment(environment, previewState) {
    if (!previewState.gated || !previewState.provisioned) {
        throw new Error('Preview environment cannot be activated before isolated resources are provisioned');
    }

    // Only after the complete PREVIEW_* contract has been checked do we replace
    // the generic names consumed by the application and third-party SDKs. This
    // prevents inherited Production variables from being read by app imports.
    for (const [target, previewName] of Object.entries(REQUIRED_PREVIEW_ENVIRONMENT)) {
        environment[target] = environment[previewName];
    }
    for (const [target, previewName] of Object.entries(OPTIONAL_PREVIEW_ENVIRONMENT)) {
        environment[target] = environment[previewName] ?? '';
    }

    for (const [target, value] of Object.entries(FORCED_PREVIEW_ENVIRONMENT)) {
        environment[target] = value;
    }
}

function writeJson(response, statusCode, body, method) {
    response.statusCode = statusCode;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (statusCode >= 500) response.setHeader('Retry-After', '300');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (method === 'HEAD') {
        response.end();
        return;
    }
    response.end(JSON.stringify(body));
}

export function createUnprovisionedPreviewHandler(now = () => new Date()) {
    return function unprovisionedPreviewHandler(request, response) {
        const pathname = new URL(request.url || '/', 'https://preview.invalid').pathname;
        const timestamp = now().toISOString();

        if (pathname === '/health') {
            writeJson(response, 200, {
                status: 'alive',
                environment: 'preview',
                applicationReady: false,
                reason: 'preview_not_provisioned',
                timestamp,
            }, request.method);
            return;
        }

        writeJson(response, 503, {
            status: 'not_ready',
            environment: 'preview',
            reason: 'preview_not_provisioned',
            timestamp,
        }, request.method);
    };
}

function createInitializationErrorHandler(error) {
    const candidateType = error instanceof Error ? error.name : 'UnknownError';
    const errorType = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(candidateType)
        ? candidateType
        : 'Error';
    console.error('FATAL: Failed to initialize Express app', {
        errorType,
    });
    return function initializationErrorHandler(request, response) {
        writeJson(response, 503, {
            status: 'not_ready',
            reason: 'application_initialization_failed',
        }, request.method);
    };
}

export async function initializeVercelHandler({
    environment = process.env,
    loadApp,
    now,
} = {}) {
    const previewState = inspectPreviewRuntime(environment);
    if (previewState.gated && !previewState.provisioned) {
        return createUnprovisionedPreviewHandler(now);
    }

    if (previewState.gated) {
        activatePreviewEnvironment(environment, previewState);
    }

    try {
        const module = await loadApp();
        if (typeof module?.default !== 'function') {
            throw new Error('Express app module does not export a request handler');
        }
        return module.default;
    } catch (error) {
        return createInitializationErrorHandler(error);
    }
}

export const previewEnvironmentContract = Object.freeze({
    enableFlag: PREVIEW_ENABLE_FLAG,
    required: { ...REQUIRED_PREVIEW_ENVIRONMENT },
    optional: { ...OPTIONAL_PREVIEW_ENVIRONMENT },
    forced: { ...FORCED_PREVIEW_ENVIRONMENT },
});
