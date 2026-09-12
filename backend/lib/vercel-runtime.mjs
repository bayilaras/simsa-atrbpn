import { initializeVercelHandler } from './preview-runtime.mjs';
import { validateNeonTarget } from '../../scripts/neon-target.mjs';
import { cloudMetadataEnvironment } from '../../scripts/cloud-metadata-config.mjs';
import { normalizeVercelPrivateBlobAlias, stripPreviewPrivateBlobAliases } from './vercel-private-blob.mjs';

const resources = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'FRONTEND_URL'];
const previewDisabledMail = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER',
    'SMTP_PASS', 'SMTP_FROM', 'SMTP_TIMEOUT_MS'];
const forbidden = ['COOKIE_DOMAIN', 'ADDITIONAL_TRUSTED_ORIGINS', 'SIMSA_FRONTEND_DIST',
    'SIMSA_INTERNAL_LOCAL', 'K_SERVICE', 'PGOPTIONS', 'DB_HOST', 'CLOUD_SQL_UNIX_SOCKET',
    'BLOB_READ_WRITE_TOKEN', 'VERCEL_BLOB_CALLBACK_URL', 'GCS_BUCKET', 'GCS_UPLOAD_BUCKET'];

function unavailable(request, response) {
    response.statusCode = 503;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Retry-After', '300');
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify({
        status: 'not_ready', reason: 'vercel_configuration_unavailable',
    }));
}

function origin(value) {
    if (typeof value !== 'string') throw new Error('Explicit HTTPS origin required');
    const url = new URL(value);
    if (url.protocol !== 'https:' || value !== url.origin || url.username || url.password
        || !url.hostname.includes('.') || url.hostname.endsWith('.')) throw new Error('Canonical HTTPS origin required');
    return url.origin;
}

/** Explicit restricted profile; all other deployments retain the existing isolation gate. */
export function configureVercelMetadata(source) {
    if (source.SIMSA_VERCEL_METADATA_ENABLED !== 'true' || source.VERCEL !== '1'
        || !['preview', 'production'].includes(source.VERCEL_ENV)
        || source.NODE_TLS_REJECT_UNAUTHORIZED === '0'
        || forbidden.some(key => Boolean(source[key]?.trim()))) throw new Error('Invalid Vercel metadata profile');
    for (const [key, value] of Object.entries(cloudMetadataEnvironment)) {
        if (source[key] !== value) throw new Error('Incomplete Vercel metadata profile');
    }
    if (source.VERCEL_ENV === 'preview') {
        if (source.SIMSA_PREVIEW_ENABLED !== 'true' || resources.some(key => {
            const value = source[`PREVIEW_${key}`];
            return !value || value !== value.trim();
        })) throw new Error('Preview is not provisioned');
    }
    const selected = { ...source };
    if (source.VERCEL_ENV === 'preview') {
        for (const key of resources) {
            const value = source[`PREVIEW_${key}`];
            if (!value || value !== value.trim()) throw new Error('Isolated Preview resources required');
            selected[key] = value;
            if (source[key]) {
                if (key === 'DATABASE_URL') {
                    const inherited = validateNeonTarget(source[key]);
                    const preview = validateNeonTarget(value);
                    if (inherited.hostname === preview.hostname && inherited.pathname === preview.pathname) {
                        throw new Error('Preview database must be isolated');
                    }
                } else if (key === 'FRONTEND_URL' || key === 'BETTER_AUTH_URL') {
                    if (new URL(source[key]).origin === new URL(value).origin) throw new Error('Preview origin must be isolated');
                } else if (source[key] === value) throw new Error('Preview resource must be isolated');
            }
        }
    }
    validateNeonTarget(selected.DATABASE_URL, { role: 'simsa_api' });
    if (origin(selected.FRONTEND_URL) !== origin(selected.BETTER_AUTH_URL)
        || typeof selected.BETTER_AUTH_SECRET !== 'string' || selected.BETTER_AUTH_SECRET.length < 32
        || /[\r\n]/.test(selected.BETTER_AUTH_SECRET)) throw new Error('Invalid authentication configuration');
    return selected;
}

export async function initializeSimsaVercelHandler({ environment = process.env, loadApp, now } = {}) {
    stripPreviewPrivateBlobAliases(environment);
    const loadSelectedApp = async () => {
        normalizeVercelPrivateBlobAlias(environment);
        return loadApp();
    };
    // Only the separate, authenticated worker function may activate this login.
    delete environment.MALWARE_WORKER_DATABASE_URL;
    delete environment.PREVIEW_MALWARE_WORKER_DATABASE_URL;
    if (environment.VERCEL_ENV !== 'production') {
        delete environment.MALWARE_SCAN_DISPATCH_TOKEN;
        delete environment.PREVIEW_MALWARE_SCAN_DISPATCH_TOKEN;
    }
    const optIn = environment.SIMSA_VERCEL_METADATA_ENABLED;
    if (optIn === undefined || optIn === '' || optIn === 'false') {
        return initializeVercelHandler({ environment, loadApp: loadSelectedApp, now });
    }
    try {
        const configured = configureVercelMetadata(environment);
        // Validation completes before generic resources are changed or app imports
        // initialize auth, database pools, and storage clients.
        if (environment.VERCEL_ENV === 'preview') {
            for (const key of resources) environment[key] = configured[key];
            // A Preview action must never send mail through inherited Production
            // credentials. This restricted profile does not provision email.
            for (const key of previewDisabledMail) environment[key] = '';
        }
        const module = await loadSelectedApp();
        if (typeof module?.default !== 'function') throw new Error('Missing request handler');
        return module.default;
    } catch {
        // Neither validation errors nor SDK/provider errors may disclose secrets.
        return unavailable;
    }
}
