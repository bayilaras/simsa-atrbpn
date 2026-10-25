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

/** Letter attachment entity types. They follow the same release rule as every other bitstream. */
export function isLetterAttachmentType(entityType?: string | null): entityType is 'surat_masuk' | 'surat_keluar' {
    return entityType === 'surat_masuk' || entityType === 'surat_keluar';
}

/** Public guidance after record ACL checks; never exposes a lease or locator. */
export function quarantinedFileScanState(metadata?: FileReleaseMetadata | null): 'pending' | 'blocked' | 'unavailable' {
    if (!metadata) return 'unavailable';
    // Letter attachments stored before the exemption was removed wait for the
    // baseline backfill (backfill-letter-attachment-scan) to queue them.
    if (metadata.storageAccess === 'private' && metadata.malwareScanStatus === 'not_required') return 'pending';
    if (metadata.storageAccess !== 'private' || !/^[a-f0-9]{64}$/i.test(metadata.sha256 || '')
        || metadata.integrityStatus === 'mismatch'
        || ['infected', 'scan_error', 'clean'].includes(metadata.malwareScanStatus || '')) return 'blocked';
    return metadata.malwareScanStatus === 'not_scanned'
        || /^(?:scanning|retry):[1-9]\d*:\d+$/.test(metadata.malwareScanStatus || '') ? 'pending' : 'unavailable';
}
