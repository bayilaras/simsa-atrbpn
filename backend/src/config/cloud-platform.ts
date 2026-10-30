export type SimsaCloudPlatform = 'local';
export type SimsaAuthProvider = 'better-auth';
export type SimsaStorageProvider = 'vercel-blob' | 'gcs' | 'disabled';

export interface CloudPlatformConfig {
    platform: SimsaCloudPlatform;
    authProvider: SimsaAuthProvider;
    storageProvider: SimsaStorageProvider;
    projectId: string;
    gcsBucket: string;
    gcsUploadBucket: string;
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

function validBucketName(value: string): boolean {
    return value.length >= 3
        && value.length <= 63
        && /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(value)
        && !value.includes('..')
        && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
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
        ['vercel-blob', 'gcs', 'disabled'] as const,
        'vercel-blob',
        'OBJECT_STORAGE_PROVIDER',
        errors,
    );
    const projectAuthorities = [
        source.GOOGLE_CLOUD_PROJECT,
        source.GCLOUD_PROJECT,
    ].map(value => value?.trim()).filter((value): value is string => Boolean(value));
    const distinctProjectAuthorities = [...new Set(projectAuthorities)];
    const projectId = projectAuthorities[0] || '';
    const gcsBucket = source.GCS_BUCKET?.trim() || '';
    const gcsUploadBucket = source.GCS_UPLOAD_BUCKET?.trim() || gcsBucket;
    const production = source.NODE_ENV === 'production';
    const deployedRuntime = production || Boolean(source.VERCEL);
    // A stale gcloud project variable must never silently move object
    // storage into another environment's GCS project.
    if (distinctProjectAuthorities.length > 1) {
        errors.push('Cloud project authority variables must identify the same project');
    }

    if (deployedRuntime && source.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
        errors.push('GOOGLE_APPLICATION_CREDENTIALS must not be set in a deployed runtime; use attached ADC/WIF');
    }

    // The metadata-demo mode was removed; a stale value must not be ignored.
    const appMode = source.SIMSA_APP_MODE?.trim().toLowerCase();
    if (appMode && appMode !== 'full') {
        errors.push('SIMSA_APP_MODE must be full');
    }
    const internalProfile = (source.APP_PROFILE || 'internal').trim().toLowerCase() === 'internal';
    if (storageProvider === 'disabled' && !internalProfile) {
        errors.push('Disabled storage is only permitted in full internal mode');
    }
    if (storageProvider === 'gcs') {
        if (!gcsBucket) errors.push('GCS_BUCKET is required when OBJECT_STORAGE_PROVIDER=gcs');
        if (gcsBucket && !validBucketName(gcsBucket)) errors.push('GCS_BUCKET is not a valid bucket name');
        if (gcsUploadBucket && !validBucketName(gcsUploadBucket)) {
            errors.push('GCS_UPLOAD_BUCKET is not a valid bucket name');
        }
        if (gcsBucket && gcsUploadBucket === gcsBucket) {
            errors.push('GCS_UPLOAD_BUCKET must be configured and differ from GCS_BUCKET');
        }
    }

    return {
        platform,
        authProvider,
        storageProvider,
        projectId,
        gcsBucket,
        gcsUploadBucket,
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
        if (!requireStorage && (error.includes('GCS_') || error.includes('OBJECT_STORAGE_PROVIDER'))) return false;
        return true;
    });
    if (relevantErrors.length > 0) {
        throw new Error(`Invalid cloud platform configuration: ${relevantErrors.join('; ')}`);
    }
    return config;
}
