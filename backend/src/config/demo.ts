export type SimsaAppMode = 'full' | 'metadata-demo';

export function loadAppMode(source: NodeJS.ProcessEnv = process.env): SimsaAppMode {
    const value = source.SIMSA_APP_MODE?.trim().toLowerCase() || 'full';
    if (value !== 'full' && value !== 'metadata-demo') {
        throw new Error('SIMSA_APP_MODE must be full or metadata-demo');
    }
    return value;
}

export function isMetadataDemo(source: NodeJS.ProcessEnv = process.env): boolean {
    return loadAppMode(source) === 'metadata-demo';
}

/**
 * A local metadata demo using the Better Auth development path must not become
 * reachable from the LAN merely because the HTTP server's default host is a
 * wildcard. Cloud/Firebase and full deployments retain the platform default.
 */
export function getDemoListenHost(source: NodeJS.ProcessEnv = process.env): string | undefined {
    if (!isMetadataDemo(source)) return undefined;

    const deployed = source.NODE_ENV === 'production'
        || Boolean(source.K_SERVICE)
        || Boolean(source.VERCEL);
    const authProvider = source.AUTH_PROVIDER?.trim().toLowerCase() || 'better-auth';
    return !deployed && authProvider === 'better-auth' ? '127.0.0.1' : undefined;
}

export function getPublicCapabilities(source: NodeJS.ProcessEnv = process.env) {
    const demo = isMetadataDemo(source);
    return {
        mode: demo ? 'metadata-demo' : 'full',
        syntheticDataOnly: demo,
        capabilities: {
            metadata: true,
            files: !demo,
            externalIntegrations: !demo && source.SRIKANDI_ENABLED?.trim().toLowerCase() === 'true',
        },
    } as const;
}

/** The demo is a distinct deployment, never a switch on a live archive DB. */
export function validateDemoEnvironment(
    runtime: string,
    source: NodeJS.ProcessEnv = process.env,
): void {
    if (!isMetadataDemo(source)) return;
    if (runtime !== 'api') throw new Error('Metadata demo does not run workers or storage event handlers');
    if ((source.APP_PROFILE || 'internal').trim().toLowerCase() !== 'internal') {
        throw new Error('Metadata demo requires APP_PROFILE=internal');
    }
    if (source.SIMSA_DEMO_DATA_ACKNOWLEDGED !== 'true') {
        throw new Error('Metadata demo requires SIMSA_DEMO_DATA_ACKNOWLEDGED=true and synthetic data only');
    }
    if (!/^simsa_demo(?:_[a-z0-9_]+)?$/.test(source.SIMSA_DEMO_DATABASE || '')) {
        throw new Error('SIMSA_DEMO_DATABASE must name a separate simsa_demo database');
    }
    if (source.DB_NAME && source.DB_NAME !== source.SIMSA_DEMO_DATABASE) {
        throw new Error('Demo DB_NAME must match SIMSA_DEMO_DATABASE');
    }
    if (source.DATABASE_URL) {
        const url = new URL(source.DATABASE_URL);
        if (decodeURIComponent(url.pathname.slice(1)) !== source.SIMSA_DEMO_DATABASE) {
            throw new Error('Demo DATABASE_URL must identify SIMSA_DEMO_DATABASE');
        }
    }
    if ((source.OBJECT_STORAGE_PROVIDER || '').trim().toLowerCase() !== 'disabled') {
        throw new Error('Metadata demo requires OBJECT_STORAGE_PROVIDER=disabled');
    }
    for (const name of [
        'GCS_BUCKET', 'GCS_UPLOAD_BUCKET', 'BLOB_READ_WRITE_TOKEN', 'VERCEL_BLOB_CALLBACK_URL',
        'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_PORT',
    ]) {
        if (source[name]?.trim()) throw new Error(`${name} must be absent in metadata demo`);
    }
    for (const name of ['SRIKANDI_ENABLED', 'MALWARE_SCAN_WORKER_ENABLED']) {
        if (source[name]?.trim() && source[name]?.trim().toLowerCase() !== 'false') {
            throw new Error(`${name} must be false in metadata demo`);
        }
    }
    if ((source.MALWARE_SCANNER_MODE || 'disabled').trim().toLowerCase() !== 'disabled') {
        throw new Error('Metadata demo requires MALWARE_SCANNER_MODE=disabled');
    }
    const deployed = source.NODE_ENV === 'production' || source.K_SERVICE || source.VERCEL;
    if (deployed && source.AUTH_PROVIDER?.trim().toLowerCase() !== 'firebase') {
        throw new Error('Deployed metadata demo requires AUTH_PROVIDER=firebase');
    }
}

export function assertDemoStorageUnavailable(source: NodeJS.ProcessEnv = process.env): void {
    if (isMetadataDemo(source) || source.OBJECT_STORAGE_PROVIDER?.trim().toLowerCase() === 'disabled') {
        throw new Error('Object storage is disabled in metadata demo');
    }
}
