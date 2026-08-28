export interface BlobStorageConfig {
    required: boolean;
    configured: boolean;
    callbackRequired: boolean;
    callbackConfigured: boolean;
    ready: boolean;
    validationErrors: string[];
}

export interface BlobStorageConfigOptions {
    /** Dedicated workers use Blob but do not receive client-upload callbacks. */
    requireCallbackUrl?: boolean;
}

function isVercelRuntime(source: NodeJS.ProcessEnv): boolean {
    return Boolean(source.VERCEL?.trim());
}

export function assertValidBlobCallbackOrigin(value: string): void {
    const normalized = value.trim();
    let parsed: URL;
    try {
        parsed = new URL(normalized);
    } catch {
        throw new Error('VERCEL_BLOB_CALLBACK_URL must be a valid absolute HTTPS origin');
    }

    // @vercel/blob appends the incoming request pathname to this base. A path
    // (including a trailing slash), query, or fragment would produce the wrong
    // signed completion callback URL.
    if (
        value !== normalized
        || parsed.protocol !== 'https:'
        || parsed.username
        || parsed.password
        || parsed.pathname !== '/'
        || normalized.endsWith('/')
        || parsed.search
        || parsed.hash
        || /[?#]/.test(normalized)
    ) {
        throw new Error(
            'VERCEL_BLOB_CALLBACK_URL must be an HTTPS origin without credentials, path, trailing slash, query, or fragment',
        );
    }
}

export function buildBlobStorageConfig(
    source: NodeJS.ProcessEnv = process.env,
    options: BlobStorageConfigOptions = {},
): BlobStorageConfig {
    const required = source.NODE_ENV === 'production' || isVercelRuntime(source);
    const callbackRequired = options.requireCallbackUrl
        ?? (source.NODE_ENV === 'production' && !isVercelRuntime(source));
    const token = source.BLOB_READ_WRITE_TOKEN?.trim() || '';
    const callbackUrl = source.VERCEL_BLOB_CALLBACK_URL || '';
    const callbackConfigured = Boolean(callbackUrl.trim());
    const errors: string[] = [];

    if (required && !token) {
        errors.push('BLOB_READ_WRITE_TOKEN is required for production record storage');
    }
    if (token && (/\r|\n/.test(token) || token.length < 16)) {
        errors.push('BLOB_READ_WRITE_TOKEN has an invalid format');
    }
    if (callbackRequired && !callbackConfigured) {
        errors.push('VERCEL_BLOB_CALLBACK_URL is required for a production API outside Vercel');
    }
    if (callbackConfigured) {
        try {
            assertValidBlobCallbackOrigin(callbackUrl);
        } catch (error) {
            errors.push(error instanceof Error ? error.message : 'VERCEL_BLOB_CALLBACK_URL is invalid');
        }
    }

    return {
        required,
        configured: Boolean(token),
        callbackRequired,
        callbackConfigured,
        ready: Boolean(token) && errors.length === 0,
        validationErrors: errors,
    };
}

export function assertValidBlobStorageEnvironment(
    source: NodeJS.ProcessEnv = process.env,
    options: BlobStorageConfigOptions = {},
): void {
    const config = buildBlobStorageConfig(source, options);
    if (config.validationErrors.length > 0) {
        throw new Error(`Invalid Blob storage configuration: ${config.validationErrors.join('; ')}`);
    }
}

export function getBlobStorageConfigurationStatus(
    config: BlobStorageConfig = buildBlobStorageConfig(),
) {
    return {
        provider: 'vercel-blob-private' as const,
        required: config.required,
        configured: config.configured,
        callbackRequired: config.callbackRequired,
        callbackConfigured: config.callbackConfigured,
        ready: config.ready,
        validationErrors: [...config.validationErrors],
    };
}
