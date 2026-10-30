import {
    buildCloudPlatformConfig,
    type SimsaStorageProvider,
} from '../config/cloud-platform.js';
import type { CopyFileOptions, StoredFile, UploadFileOptions } from '../storage/types.js';
import { ServiceUnavailableError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { blobStorageService } from './blob-storage.service.js';

const log = createLogger('DurableFinalObjectService');

export interface FinalObjectWrite {
    stored: StoredFile;
}

interface DurableFinalObjectServiceOptions {
    provider?: () => SimsaStorageProvider;
    storage?: Pick<typeof blobStorageService, 'uploadFile' | 'copyFile' | 'deleteFile'>;
}

/**
 * Writes API-generated final objects (authentication PDFs and copied
 * regulatory sources) to private Vercel Blob. A rolled-back domain
 * transaction deletes the immutable object it created.
 */
export class DurableFinalObjectService {
    private readonly provider: () => SimsaStorageProvider;
    private readonly storage: Pick<
        typeof blobStorageService,
        'uploadFile' | 'copyFile' | 'deleteFile'
    >;

    constructor(options: DurableFinalObjectServiceOptions = {}) {
        this.provider = options.provider
            ?? (() => buildCloudPlatformConfig().storageProvider);
        this.storage = options.storage ?? blobStorageService;
    }

    private requireStorageProvider(): void {
        if (this.provider() === 'disabled') {
            throw new ServiceUnavailableError('Object storage is disabled for this deployment.');
        }
    }

    async upload(_ownerId: string, options: UploadFileOptions): Promise<FinalObjectWrite> {
        this.requireStorageProvider();
        return { stored: await this.storage.uploadFile(options) };
    }

    async copy(_ownerId: string, options: CopyFileOptions): Promise<FinalObjectWrite> {
        this.requireStorageProvider();
        return { stored: await this.storage.copyFile(options) };
    }

    async compensate(write: FinalObjectWrite | null, cause: unknown): Promise<void> {
        if (!write) return;
        this.requireStorageProvider();
        const deleted = await this.storage.deleteFile(write.stored.url);
        if (!deleted) {
            log.error({ locator: write.stored.url, err: cause },
                'Blob compensation failed; manual cleanup is required');
        }
    }
}

export const durableFinalObjectService = new DurableFinalObjectService();
