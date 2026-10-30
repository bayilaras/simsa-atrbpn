export type SimsaCloudPlatform = 'local';
export type SimsaAuthProvider = 'better-auth';
export type SimsaStorageProvider = 'vercel-blob' | 'disabled';

export interface CloudPlatformConfig {
    platform: SimsaCloudPlatform;
    authProvider: SimsaAuthProvider;
    storageProvider: SimsaStorageProvider;
    validationErrors: string[];
}

function choice<T extends string>(
    value: string | undefined,
    allowed: readonly T[],
    fallback: T,
    name: string,
    errors: string[],
): T {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) return fallback;
    if ((allowed as readonly string[]).includes(normalized)) return normalized as T;
    errors.push(`${name} must be one of: ${allowed.join(', ')}`);
    return fallback;
}

/**
 * Resolves the target platform without consulting a remote control plane.
 * Every production choice is explicit and startup validation fails closed.
 */
export function buildCloudPlatformConfig(
    source: NodeJS.ProcessEnv = process.env,
): CloudPlatformConfig {
    const errors: string[] = [];
    const platform = choice(
        source.SIMSA_CLOUD_PLATFORM,
        ['local'] as const,
        'local',
        'SIMSA_CLOUD_PLATFORM',
        errors,
    );
    const authProvider = choice(
        source.AUTH_PROVIDER,
        ['better-auth'] as const,
        'better-auth',
        'AUTH_PROVIDER',
        errors,
    );
    const storageProvider = choice(
        source.OBJECT_STORAGE_PROVIDER,
        ['vercel-blob', 'disabled'] as const,
        'vercel-blob',
        'OBJECT_STORAGE_PROVIDER',
        errors,
    );

    // The metadata-demo mode was removed; a stale value must not be ignored.
    const appMode = source.SIMSA_APP_MODE?.trim().toLowerCase();
    if (appMode && appMode !== 'full') {
        errors.push('SIMSA_APP_MODE must be full');
    }
    const internalProfile = (source.APP_PROFILE || 'internal').trim().toLowerCase() === 'internal';
    if (storageProvider === 'disabled' && !internalProfile) {
        errors.push('Disabled storage is only permitted in full internal mode');
    }

    return {
        platform,
        authProvider,
        storageProvider,
        validationErrors: errors,
    };
}

export function assertValidCloudPlatformEnvironment(
    source: NodeJS.ProcessEnv = process.env,
    options: { requireAuth?: boolean; requireStorage?: boolean } = {},
): CloudPlatformConfig {
    const config = buildCloudPlatformConfig(source);
    const requireAuth = options.requireAuth ?? true;
    const requireStorage = options.requireStorage ?? true;
    const relevantErrors = config.validationErrors.filter(error => {
        if (!requireAuth && error.includes('AUTH_PROVIDER')) return false;
        if (!requireStorage && error.includes('OBJECT_STORAGE_PROVIDER')) return false;
        return true;
    });
    if (relevantErrors.length > 0) {
        throw new Error(`Invalid cloud platform configuration: ${relevantErrors.join('; ')}`);
    }
    return config;
}
