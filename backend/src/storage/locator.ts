export interface GcsLocator {
    bucket: string;
    objectName: string;
}

function isCanonicalBucketName(value: string): boolean {
    return value.length >= 3
        && value.length <= 222
        && /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(value)
        && !value.includes('..')
        && !value.includes('.-')
        && !value.includes('-.');
}

function isCanonicalObjectName(value: string): boolean {
    const segments = value.split('/');
    return Boolean(value)
        && !value.startsWith('/')
        && !value.includes('\\')
        && segments.every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

function encodeObjectName(value: string): string {
    return value.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function decodeObjectName(value: string): string {
    try {
        return value.split('/').map(segment => decodeURIComponent(segment)).join('/');
    } catch {
        throw new Error('Invalid percent encoding in Cloud Storage locator');
    }
}

export function toGcsLocator(bucket: string, objectName: string): string {
    if (!isCanonicalBucketName(bucket) || !isCanonicalObjectName(objectName)) {
        throw new Error('Cloud Storage bucket and object name must be canonical');
    }
    return `gs://${bucket}/${encodeObjectName(objectName)}`;
}

export function parseGcsLocator(locator: string): GcsLocator {
    if (!locator.startsWith('gs://')) throw new Error('Not a Cloud Storage locator');
    const withoutScheme = locator.slice('gs://'.length);
    const separator = withoutScheme.indexOf('/');
    if (separator <= 0 || separator === withoutScheme.length - 1) {
        throw new Error('Cloud Storage locator must include bucket and object name');
    }
    const bucket = withoutScheme.slice(0, separator);
    const objectName = decodeObjectName(withoutScheme.slice(separator + 1));
    if (!isCanonicalBucketName(bucket) || !isCanonicalObjectName(objectName)) {
        throw new Error('Cloud Storage locator is not canonical');
    }
    if (locator !== toGcsLocator(bucket, objectName)) {
        throw new Error('Cloud Storage locator is not canonical');
    }
    return { bucket, objectName };
}

/**
 * Bind a storage locator to one immutable object generation. Vercel Blob URLs
 * are immutable by construction and therefore must not carry a GCS generation.
 */
export function requireImmutableObjectGeneration(
    locator: string,
    generation: string | null | undefined,
): string | null {
    if (locator.startsWith('gs://')) {
        parseGcsLocator(locator);
        if (!generation || !/^\d+$/.test(generation)) {
            throw new Error('Cloud Storage locator requires an immutable object generation');
        }
        return generation;
    }
    if (generation !== null && generation !== undefined) {
        throw new Error('A non-GCS locator must not carry a Cloud Storage generation');
    }
    return null;
}

export function isVercelBlobLocator(locator: string): boolean {
    try {
        const parsed = new URL(locator.startsWith('blob:') ? locator.slice(5) : locator);
        return parsed.protocol === 'https:'
            && parsed.hostname.endsWith('.blob.vercel-storage.com')
            && !parsed.username
            && !parsed.password;
    } catch {
        return false;
    }
}

/** Normalize only canonical internal locators; never accept signed/public URLs. */
export function normalizeStoredObjectLocator(value: string | null | undefined): string | null {
    if (!value) return null;
    const locator = value.startsWith('blob:') ? value.slice('blob:'.length) : value;
    if (locator.startsWith('gs://')) {
        try {
            const parsed = parseGcsLocator(locator);
            return toGcsLocator(parsed.bucket, parsed.objectName);
        } catch {
            return null;
        }
    }
    try {
        const parsed = new URL(locator);
        if (
            parsed.protocol === 'https:'
            && parsed.hostname.endsWith('.private.blob.vercel-storage.com')
            && parsed.hostname.length > '.private.blob.vercel-storage.com'.length
            && !parsed.username
            && !parsed.password
            && !parsed.port
            && !parsed.search
            && !parsed.hash
        ) {
            return parsed.toString();
        }
    } catch {
        // Local/Drive references are deliberately not treated as object locators.
    }
    return null;
}
