const AUTH_PROVIDERS = new Set(['better-auth', 'firebase']);
const STORAGE_PROVIDERS = new Set(['vercel-blob', 'gcs', 'disabled']);

function normalizeProvider(value, fallback, allowed, variableName) {
    const provider = typeof value === 'string' && value.trim()
        ? value.trim().toLowerCase()
        : fallback;

    if (!allowed.has(provider)) {
        throw new Error(
            `${variableName} tidak valid: "${provider}". Pilihan: ${[...allowed].join(', ')}.`,
        );
    }
    return provider;
}

export function resolveCloudProviderConfig(env = {}) {
    return Object.freeze({
        authProvider: normalizeProvider(
            env.VITE_AUTH_PROVIDER,
            'better-auth',
            AUTH_PROVIDERS,
            'VITE_AUTH_PROVIDER',
        ),
        storageProvider: normalizeProvider(
            env.VITE_STORAGE_PROVIDER,
            'vercel-blob',
            STORAGE_PROVIDERS,
            'VITE_STORAGE_PROVIDER',
        ),
    });
}

export const CLOUD_PROVIDER_CONFIG = resolveCloudProviderConfig(import.meta.env);
export const AUTH_PROVIDER = CLOUD_PROVIDER_CONFIG.authProvider;
export const STORAGE_PROVIDER = CLOUD_PROVIDER_CONFIG.storageProvider;
export const USE_FIREBASE_AUTH = AUTH_PROVIDER === 'firebase';
export const USE_GCS_STORAGE = STORAGE_PROVIDER === 'gcs';
export const FILE_STORAGE_DISABLED = STORAGE_PROVIDER === 'disabled';
