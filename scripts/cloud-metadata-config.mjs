import path from 'node:path';

export const cloudMetadataEnvironment = Object.freeze({
    NODE_ENV: 'production',
    APP_PROFILE: 'internal',
    SIMSA_APP_MODE: 'full',
    SIMSA_CLOUD_PLATFORM: 'local',
    AUTH_PROVIDER: 'better-auth',
    OBJECT_STORAGE_PROVIDER: 'disabled',
    GOOGLE_OAUTH_ENABLED: 'false',
    MALWARE_SCANNER_MODE: 'disabled',
    MALWARE_SCAN_WORKER_ENABLED: 'false',
    SRIKANDI_ENABLED: 'false',
});

function httpsOrigin(value) {
    let url;
    try { url = new URL(value); }
    catch { throw new Error('Cloud metadata hosting requires an explicit HTTPS origin.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || url.pathname !== '/' || !url.hostname.includes('.') || url.hostname.endsWith('.')) {
        throw new Error('Cloud metadata hosting requires a canonical HTTPS origin without a path.');
    }
    return url.origin;
}

/** Validate the dedicated free-cloud entrypoint without changing other profiles. */
export function configureCloudMetadata(source, repositoryRoot) {
    for (const [key, value] of Object.entries(cloudMetadataEnvironment)) {
        if (source[key] !== value) throw new Error(`Cloud metadata hosting requires ${key}=${value}.`);
    }
    if (source.K_SERVICE || source.VERCEL || source.SIMSA_INTERNAL_LOCAL
        || source.NODE_TLS_REJECT_UNAUTHORIZED === '0'
        || source.COOKIE_DOMAIN?.trim() || source.ADDITIONAL_TRUSTED_ORIGINS?.trim()) {
        throw new Error('Cloud metadata hosting requires its own same-origin runtime configuration.');
    }
    const frontendOrigin = httpsOrigin(source.FRONTEND_URL?.trim() || source.RENDER_EXTERNAL_URL?.trim());
    const authOrigin = httpsOrigin(source.BETTER_AUTH_URL?.trim() || frontendOrigin);
    if (authOrigin !== frontendOrigin) throw new Error('Frontend and authentication must use the same HTTPS origin.');
    const dist = path.join(repositoryRoot, 'frontend', 'dist-cloud-metadata');
    if (source.SIMSA_FRONTEND_DIST && path.resolve(source.SIMSA_FRONTEND_DIST) !== dist) {
        throw new Error('Cloud metadata hosting requires frontend/dist-cloud-metadata.');
    }
    return { ...source, FRONTEND_URL: frontendOrigin, BETTER_AUTH_URL: authOrigin, SIMSA_FRONTEND_DIST: dist };
}

export function validateCloudMetadataManifest(manifest) {
    const expected = {
        schemaVersion: 1, mode: 'full', syntheticDataOnly: false, api: 'same-origin',
        authProvider: 'better-auth', storageProvider: 'disabled', firebase: null,
    };
    if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object'
        || Object.keys(manifest).length !== Object.keys(expected).length
        || Object.entries(expected).some(([key, value]) => manifest[key] !== value)) {
        throw new Error('Cloud metadata frontend build does not match the backend profile.');
    }
}
