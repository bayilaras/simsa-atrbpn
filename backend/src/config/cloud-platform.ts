export type SimsaCloudPlatform = 'local' | 'gcp';
export type SimsaAuthProvider = 'better-auth' | 'firebase';
export type SimsaStorageProvider = 'vercel-blob' | 'gcs';

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
    const inferredPlatform: SimsaCloudPlatform = source.K_SERVICE ? 'gcp' : 'local';
    const platform = choice(
        source.SIMSA_CLOUD_PLATFORM,
        ['local', 'gcp'] as const,
        inferredPlatform,
        'SIMSA_CLOUD_PLATFORM',
        errors,
    );
    const authProvider = choice(
        source.AUTH_PROVIDER,
        ['better-auth', 'firebase'] as const,
        platform === 'gcp' ? 'firebase' : 'better-auth',
        'AUTH_PROVIDER',
        errors,
    );
    const storageProvider = choice(
        source.OBJECT_STORAGE_PROVIDER,
        ['vercel-blob', 'gcs'] as const,
        platform === 'gcp' ? 'gcs' : 'vercel-blob',
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
    const cloudRunRuntime = Boolean(source.K_SERVICE);
    const deployedRuntime = production || cloudRunRuntime || Boolean(source.VERCEL);
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
    // Cloud SQL/GCS project. Preview, Staging, and Production are hard project
    // boundaries in the target architecture.
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

    // K_SERVICE is injected by Cloud Run and is therefore a stronger runtime
    // authority than mutable provider environment variables. A typo or stale
    // rollback variable must not silently start the public API against the
    // legacy auth/storage control planes.
    if (cloudRunRuntime && platform !== 'gcp') {
        errors.push('Cloud Run requires SIMSA_CLOUD_PLATFORM=gcp');
    }
    if (platform === 'gcp' && authProvider !== 'firebase') {
        errors.push('The GCP platform requires AUTH_PROVIDER=firebase');
    }
    if (platform === 'gcp' && storageProvider !== 'gcs') {
        errors.push('The GCP platform requires OBJECT_STORAGE_PROVIDER=gcs');
    }

    if (platform === 'gcp' && !projectId) {
        errors.push('GOOGLE_CLOUD_PROJECT (or FIREBASE_PROJECT_ID) is required on GCP');
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

/** Enforce keyless, environment-bound Cloud SQL Auth Proxy connectivity. */
export function assertGcpIamDatabaseRuntimeEnvironment(
    source: NodeJS.ProcessEnv,
    projectId: string,
): void {
    if (!projectId) throw new Error('GCP database boundary requires a project ID');
    if (source.DATABASE_URL?.trim()) {
        throw new Error('GCP runtimes must use the local Cloud SQL Auth Proxy, not DATABASE_URL');
    }
    const host = source.DB_HOST?.trim();
    const socket = source.CLOUD_SQL_UNIX_SOCKET?.trim();
    if (host && host !== '127.0.0.1') {
        throw new Error('GCP DB_HOST must be the loopback Cloud SQL Auth Proxy');
    }
    if (socket && !socket.startsWith(`/cloudsql/${projectId}:`)) {
        throw new Error('CLOUD_SQL_UNIX_SOCKET must belong to this environment project');
    }
    if (!host && !socket) {
        throw new Error('GCP runtimes require a loopback or project-bound Cloud SQL Auth Proxy');
    }
    if (source.DB_PASSWORD !== '') {
        throw new Error('GCP runtime DB_PASSWORD must be empty when automatic IAM auth is enabled');
    }
    if (!source.DB_USER?.trim().endsWith(`@${projectId}.iam`)) {
        throw new Error('GCP DB_USER must be the environment service-account IAM database principal');
    }
    if (source.DB_SSL?.trim().toLowerCase() === 'true') {
        throw new Error('GCP runtime DB_SSL must be false between the process and local Auth Proxy');
    }
}
