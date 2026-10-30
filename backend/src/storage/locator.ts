import { createHash } from 'node:crypto';

/**
 * Vercel Blob URLs are immutable by construction and never carry an object
 * generation. The generation columns therefore always stay null. Cloud
 * Storage (gs://) locators are not supported and fail closed.
 */
export function requireImmutableObjectGeneration(
    locator: string,
    generation: string | null | undefined,
): string | null {
    if (locator.startsWith('gs://')) {
        throw new Error('Cloud Storage (gs://) locators are not supported');
    }
    if (generation !== null && generation !== undefined) {
        throw new Error('A Vercel Blob locator must not carry an object generation');
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

/** Names reserved by a durable bulk batch before any provider write. */
export function assertReservedBulkObjectName(value: string): string {
    if (!/^bulk-upload\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(?:[0-9]|[1-4][0-9])\.pdf$/i.test(value)) {
        throw new Error('Reserved bulk object name is outside its bounded namespace');
    }
    return value;
}

export function bulkUploadObjectName(batchId: string, index: number): string {
    return assertReservedBulkObjectName(`bulk-upload/${batchId}/${index}.pdf`);
}

export function assertBulkObjectLocator(locator: string, objectName: string): void {
    assertReservedBulkObjectName(objectName);
    const normalized = normalizeStoredObjectLocator(locator);
    const actualName = normalized ? decodeURIComponent(new URL(normalized).pathname.slice(1)) : null;
    if (actualName !== objectName) throw new Error('Provider object is outside the reserved bulk namespace');
}

/**
 * Log-safe description of a stored object locator. Object names begin with the
 * uploader's file name, which often carries a letter number or subject, so a
 * log keeps only the host, the top-level folder, the random suffix Vercel Blob
 * appends, and a digest of the full locator. The suffix or the digest is
 * enough to find the object in a store listing during reconciliation.
 */
export function describeLocatorForLog(locator: string | null | undefined) {
    if (!locator) return null;
    const sha256 = createHash('sha256').update(locator).digest('hex').slice(0, 16);
    try {
        const url = new URL(locator);
        const segments = url.pathname.split('/').filter(Boolean);
        const suffix = /-([A-Za-z0-9]{16,64})\.[A-Za-z0-9]{1,8}$/.exec(segments.at(-1) ?? '')?.[1] ?? null;
        return { host: url.host, folder: segments.length > 1 ? segments[0] : null, suffix, sha256 };
    } catch {
        return { sha256 };
    }
}
