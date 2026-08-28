import { blobStorageService } from '../services/blob-storage.service.js';
import { createLogger } from './logger.js';

const log = createLogger('BlobUploadCompensation');

/**
 * Compensate only a locator captured directly from uploadFile() in the current
 * request. Callers must never pass an old database locator or a URL supplied by
 * the client.
 */
export async function deleteRequestCreatedBlob(
    blobUrl: string | null | undefined,
    context: Record<string, unknown>,
): Promise<void> {
    if (!blobUrl) return;
    const deleted = await blobStorageService.deleteFile(blobUrl);
    if (!deleted) {
        log.error({ ...context, blobUrl }, 'Failed to compensate request-created Blob; reconciliation required');
    }
}
