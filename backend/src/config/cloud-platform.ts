export type SimsaCloudPlatform = 'local';
export type SimsaAuthProvider = 'better-auth' | 'firebase';
export type SimsaStorageProvider = 'vercel-blob' | 'gcs' | 'disabled';

export interface CloudPlatformConfig {
    platform: SimsaCloudPlatform;
    authProvider: SimsaAuthProvider;
    storageProvider: SimsaStorageProvider;
    projectId: string;
    firebaseProjectId: string;
    firebaseSessionCookieName: '__session';
    firebaseSessionMaxAgeMs: number;
    firebaseCheckRevoked: boolean;
    firebaseAppCheckRequired: boolean;
    firebaseAppCheckAppIds: readonly string[];
    firebaseSessionCsrfSecret: string;
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

function booleanValue(
    value: string | undefined,
    fallback: boolean,
    name: string,
    errors: string[],
): boolean {
    if (value === undefined || value.trim() === '') return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    errors.push(`${name} must be true or false`);
    return fallback;
}

function boundedHours(
    value: string | undefined,
    fallback: number,
    name: string,
    errors: string[],
): number {
    const hours = value?.trim() ? Number(value) : fallback;
    if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 14) {
        errors.push(`${name} must be between 1 and 336 hours`);
        return Math.floor(fallback * 60 * 60 * 1000);
    }
    return Math.floor(hours * 60 * 60 * 1000);
}

function validBucketName(value: string): boolean {
    return value.length >= 3
        && value.length <= 63
        && /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(value)
        && !value.includes('..')
        && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

function firebaseWebAppIds(value: string | undefined, errors: string[]): string[] {
    const values = (value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
    const unique = [...new Set(values)];
    if (unique.length !== values.length) {
        errors.push('FIREBASE_APP_CHECK_APP_IDS must not contain duplicate app IDs');
    }
    if (unique.some(appId => !/^1:[0-9]{6,}:web:[0-9a-f]{8,}$/i.test(appId))) {
        errors.push('FIREBASE_APP_CHECK_APP_IDS must contain canonical Firebase Web App IDs');
    }
    return unique;
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
        ['better-auth', 'firebase'] as const,
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
        source.FIREBASE_PROJECT_ID,
    ].map(value => value?.trim()).filter((value): value is string => Boolean(value));
    const distinctProjectAuthorities = [...new Set(projectAuthorities)];
    const projectId = projectAuthorities[0] || '';
    const firebaseProjectId = (source.FIREBASE_PROJECT_ID || projectId).trim();
    const firebaseSessionCsrfSecret = source.FIREBASE_SESSION_CSRF_SECRET?.trim() || '';
    const gcsBucket = source.GCS_BUCKET?.trim() || '';
    const gcsUploadBucket = source.GCS_UPLOAD_BUCKET?.trim() || gcsBucket;
    const production = source.NODE_ENV === 'production';
    const deployedRuntime = production || Boolean(source.VERCEL);
    const firebaseCheckRevoked = booleanValue(
        source.FIREBASE_CHECK_REVOKED,
        deployedRuntime && authProvider === 'firebase',
        'FIREBASE_CHECK_REVOKED',
        errors,
    );
    const firebaseAppCheckRequired = booleanValue(
        source.FIREBASE_APP_CHECK_REQUIRED,
        deployedRuntime && authProvider === 'firebase',
        'FIREBASE_APP_CHECK_REQUIRED',
        errors,
    );
    const firebaseAppCheckAppIds = firebaseWebAppIds(
        source.FIREBASE_APP_CHECK_APP_IDS,
        errors,
    );

    // A stale Firebase or gcloud project variable must never silently move
    // authentication into another environment while data remains in this
    // GCS project.
    if (distinctProjectAuthorities.length > 1) {
        errors.push('Cloud project authority variables must identify the same project');
    }

    // Firebase Admin deliberately accepts unsigned emulator credentials when
    // this variable is present. A leaked local-development setting must never
    // be able to change the trust model of a deployed runtime.
    if (deployedRuntime && source.FIREBASE_AUTH_EMULATOR_HOST?.trim()) {
        errors.push('FIREBASE_AUTH_EMULATOR_HOST must not be set in a deployed runtime');
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
    if (authProvider === 'firebase') {
        if (!firebaseProjectId) {
            errors.push('FIREBASE_PROJECT_ID is required when AUTH_PROVIDER=firebase');
        }
        if (deployedRuntime && firebaseSessionCsrfSecret.length < 32) {
            errors.push('FIREBASE_SESSION_CSRF_SECRET must be at least 32 characters in a deployed runtime');
        }
        if (deployedRuntime && !firebaseCheckRevoked) {
            errors.push('FIREBASE_CHECK_REVOKED must remain true in a deployed Firebase runtime');
        }
        if (deployedRuntime && !firebaseAppCheckRequired) {
            errors.push('FIREBASE_APP_CHECK_REQUIRED must remain true in a deployed Firebase runtime');
        }
        if (deployedRuntime && firebaseAppCheckRequired && firebaseAppCheckAppIds.length === 0) {
            errors.push('FIREBASE_APP_CHECK_APP_IDS is required in a deployed Firebase runtime');
        }
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
        firebaseProjectId,
        // Firebase Hosting only forwards this specially named cookie.
        firebaseSessionCookieName: '__session',
        firebaseSessionMaxAgeMs: boundedHours(
            source.FIREBASE_SESSION_MAX_AGE_HOURS,
            24,
            'FIREBASE_SESSION_MAX_AGE_HOURS',
            errors,
        ),
        firebaseCheckRevoked,
        firebaseAppCheckRequired,
        firebaseAppCheckAppIds,
        firebaseSessionCsrfSecret,
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
        if (
            !requireAuth
            && (error.includes('FIREBASE_') || error.includes('AUTH_PROVIDER'))
            && !error.includes('FIREBASE_AUTH_EMULATOR_HOST')
        ) return false;
        if (!requireStorage && (error.includes('GCS_') || error.includes('OBJECT_STORAGE_PROVIDER'))) return false;
        return true;
    });
    if (relevantErrors.length > 0) {
        throw new Error(`Invalid cloud platform configuration: ${relevantErrors.join('; ')}`);
    }
    return config;
}
