import { normalizeStoredObjectLocator } from '../storage/locator.js';

export interface FileReleaseMetadata {
    entityType?: string | null;
    fileUrl?: string | null;
    driveFileId?: string | null;
    storageAccess?: string | null;
    sha256?: string | null;
    integrityStatus?: string | null;
    malwareScanStatus?: string | null;
}
/**
 * Controlled bitstreams stay quarantined until an external malware scanner has
 * positively released them. A hash baseline is also mandatory and a known
 * fixity match must have been verified from the same complete scan stream.
 */
export function isFileReleased(metadata: FileReleaseMetadata): boolean {
    return metadata.storageAccess === 'private'
        && /^[a-f0-9]{64}$/i.test(metadata.sha256 || '')
        && metadata.malwareScanStatus === 'clean'
        && metadata.integrityStatus === 'verified';
}

/** Letter attachment entity types; storage-specific release rules are applied below. */
export function isLetterAttachmentType(entityType?: string | null): entityType is 'surat_masuk' | 'surat_keluar' {
    return entityType === 'surat_masuk' || entityType === 'surat_keluar';
}

/** Anchored equivalent for persisted queue locators; never accepts a public or lookalike host. */
export const PRIVATE_LETTER_BLOB_SQL_PATTERN = '^(blob:)?https://[a-z0-9-]+[.]private[.]blob[.]vercel-storage[.]com/[^?#[:space:]]+$';

/** GCS still needs inspection to promote a quarantined object to retained storage. */
export function requiresAttachmentInspection(entityType?: string | null, locator?: string | null): boolean {
    if (!isLetterAttachmentType(entityType)) return true;
    const normalized = normalizeStoredObjectLocator(locator);
    if (!normalized?.startsWith('https://')) return true;
    const url = new URL(normalized);
    return !/^[a-z0-9-]+\.private\.blob\.vercel-storage\.com$/i.test(url.hostname) || url.pathname === '/';
}

/** Access policy only; preservation evidence must continue using isFileReleased. */
export function isAttachmentAvailable(metadata: FileReleaseMetadata): boolean {
    return !requiresAttachmentInspection(metadata.entityType, metadata.fileUrl || metadata.driveFileId)
        ? metadata.storageAccess === 'private'
        : isFileReleased(metadata);
}

/** Public guidance after record ACL checks; never exposes a lease or locator. */
export function quarantinedFileScanState(metadata?: FileReleaseMetadata | null): 'pending' | 'blocked' | 'unavailable' {
    if (!metadata) return 'unavailable';
    if (metadata.storageAccess !== 'private' || !/^[a-f0-9]{64}$/i.test(metadata.sha256 || '')
        || metadata.integrityStatus === 'mismatch'
        || ['infected', 'scan_error', 'clean'].includes(metadata.malwareScanStatus || '')) return 'blocked';
    return metadata.malwareScanStatus === 'not_scanned'
        || /^(?:scanning|retry):[1-9]\d*:\d+$/.test(metadata.malwareScanStatus || '') ? 'pending' : 'unavailable';
}
