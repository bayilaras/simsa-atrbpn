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
