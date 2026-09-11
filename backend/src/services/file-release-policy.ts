export interface FileReleaseMetadata {
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

/** Public guidance after record ACL checks; never exposes a lease or locator. */
export function quarantinedFileScanState(metadata?: FileReleaseMetadata | null): 'pending' | 'blocked' | 'unavailable' {
    if (!metadata) return 'unavailable';
    if (metadata.storageAccess !== 'private' || !/^[a-f0-9]{64}$/i.test(metadata.sha256 || '')
        || metadata.integrityStatus === 'mismatch'
        || ['infected', 'scan_error', 'clean'].includes(metadata.malwareScanStatus || '')) return 'blocked';
    return metadata.malwareScanStatus === 'not_scanned'
        || /^(?:scanning|retry):[1-9]\d*:\d+$/.test(metadata.malwareScanStatus || '') ? 'pending' : 'unavailable';
}
