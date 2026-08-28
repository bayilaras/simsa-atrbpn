import dotenv from 'dotenv';
import { loadAppProfile, validateAppProfileEnvironment } from './app-profile.js';
import { assertValidSrikandiEnvironment, buildSrikandiConfig } from './srikandi.js';
import { loadMalwareScanConfig, validateMalwareScanConfig } from './malware-scanner.js';
import { assertValidBlobStorageEnvironment } from './blob-storage.js';

dotenv.config();

export const malwareScanConfig = loadMalwareScanConfig();
const appProfile = loadAppProfile();

export const env = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    APP_PROFILE: appProfile,
    PORT: parseInt(process.env.PORT || '3001', 10),

    // Database
    DATABASE_URL: process.env.DATABASE_URL || '',

    // Better Auth is only an API dependency. Keep module construction side-effect
    // free so dedicated workers can import shared code without API credentials;
    // validateRuntimeEnv('api') still rejects this fallback before serving traffic.
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || 'dev-only-insecure-secret-do-not-use-in-production',
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || 'http://localhost:3001',

    // Google OAuth
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',

    // Frontend
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',

    // Extra browser origins allowed to call this API, comma separated.
    // Use for a second custom domain or a staging frontend.
    ADDITIONAL_TRUSTED_ORIGINS: process.env.ADDITIONAL_TRUSTED_ORIGINS || '',

    // Set by Vercel: 'production' | 'preview' | 'development'.
    VERCEL_ENV: process.env.VERCEL_ENV || '',

    // Cookie domain (set to .yourdomain.com when using custom domain)
    COOKIE_DOMAIN: process.env.COOKIE_DOMAIN || '',
};

export type SimsaRuntime = 'api' | 'malware-worker' | 'srikandi-worker';

function validateFrontendUrl(source: NodeJS.ProcessEnv): void {
    const raw = source.FRONTEND_URL?.trim() || 'http://localhost:3000';
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error('FRONTEND_URL must be a valid absolute URL');
    }
    if (
        !['http:', 'https:'].includes(parsed.protocol)
        || parsed.username
        || parsed.password
        || parsed.search
        || parsed.hash
        || (parsed.pathname !== '/' && parsed.pathname !== '')
    ) {
        throw new Error('FRONTEND_URL must be an HTTP(S) origin without credentials, path, query, or fragment');
    }
    if (source.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
        throw new Error('FRONTEND_URL must use HTTPS in production');
    }
}

export function validateRuntimeEnv(
    runtime: SimsaRuntime,
    source: NodeJS.ProcessEnv = process.env,
) {
    const required = runtime === 'api'
        ? ['DATABASE_URL', 'BETTER_AUTH_SECRET']
        : ['DATABASE_URL'];
    const missing = required.filter(key => !source[key]?.trim());

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    // Enforce minimum length for auth secret (cryptographic requirement)
    const secret = source.BETTER_AUTH_SECRET || '';
    if (runtime === 'api' && secret.length < 32) {
        throw new Error(
            `BETTER_AUTH_SECRET must be at least 32 characters long (current: ${secret.length}). ` +
            `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
        );
    }

    // Production safety checks
    if (runtime === 'api' && source.NODE_ENV === 'production') {
        // Google OAuth is required for authentication in production
        const oauthRequired = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
        const oauthMissing = oauthRequired.filter(key => !source[key]);

        if (oauthMissing.length > 0) {
            throw new Error(`Missing Google OAuth credentials in production: ${oauthMissing.join(', ')}`);
        }

        // Warn if DATABASE_URL points to localhost in production
        const dbUrl = source.DATABASE_URL || '';
        if (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')) {
            process.stderr.write('WARNING: DATABASE_URL points to localhost in production environment!\n');
        }

        // Warn if BETTER_AUTH_URL is still default
        const authUrl = source.BETTER_AUTH_URL || '';
        if (authUrl.includes('localhost')) {
            process.stderr.write('WARNING: BETTER_AUTH_URL points to localhost in production environment!\n');
        }
    }

    if (runtime === 'api') validateFrontendUrl(source);

    const runtimeProfile = loadAppProfile(source);
    if (runtime !== 'malware-worker') {
        validateAppProfileEnvironment(runtimeProfile, source);
    }

    if (runtime === 'srikandi-worker') {
        assertValidSrikandiEnvironment(source);
        const integration = buildSrikandiConfig(source);
        if (!integration.enabled || !integration.ready) {
            throw new Error(
                'SRIKANDI worker requires SRIKANDI_ENABLED=true and a complete official delivery contract',
            );
        }
        return;
    }

    const runtimeMalwareConfig = loadMalwareScanConfig(source);

    // Production bitstreams require a real scanner; disabled or ambiguous
    // scanner configuration never constitutes a successful scan.
    validateMalwareScanConfig(
        runtimeMalwareConfig,
        source.NODE_ENV === 'production' || source.VERCEL ? 'production' : (source.NODE_ENV || 'development'),
        source,
    );

    if (runtime === 'malware-worker') {
        if (source.VERCEL) {
            throw new Error('The malware scan worker requires a persistent runtime and cannot run as a Vercel function');
        }
        if (runtimeMalwareConfig.worker.runtime !== 'external') {
            throw new Error('Set MALWARE_SCAN_WORKER_RUNTIME=external for the dedicated worker process');
        }
        if (runtimeMalwareConfig.mode !== 'clamav' || !runtimeMalwareConfig.workerEnabled) {
            throw new Error(
                'The dedicated worker requires MALWARE_SCANNER_MODE=clamav and MALWARE_SCAN_WORKER_ENABLED=true',
            );
        }
        assertValidBlobStorageEnvironment(source, { requireCallbackUrl: false });
        return;
    }

    if (
        runtimeProfile === 'internal'
        && runtimeMalwareConfig.mode === 'disabled'
        && (source.NODE_ENV === 'production' || source.VERCEL)
    ) {
        process.stderr.write(
            'WARNING: Malware scanner is disabled; every uploaded bitstream remains quarantined and unavailable until a clean scan is recorded.\n',
        );
    }

    // Outbound SRIKANDI traffic is disabled by default. If an operator opts in,
    // fail startup unless endpoint, credential, and official response contract
    // validation are all complete.
    assertValidSrikandiEnvironment(source);

    // Private Blob is the canonical bitstream store. Production must fail at
    // startup rather than accepting records whose evidence cannot be stored.
    assertValidBlobStorageEnvironment(source, {
        requireCallbackUrl: source.NODE_ENV === 'production' && !source.VERCEL?.trim(),
    });
}

// Backwards-compatible API/server validation entry point.
export function validateEnv() {
    validateRuntimeEnv('api', process.env);
}

