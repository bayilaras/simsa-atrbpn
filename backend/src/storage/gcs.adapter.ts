import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Storage } from '@google-cloud/storage';
import { buildCloudPlatformConfig } from '../config/cloud-platform.js';
import { createLogger } from '../utils/logger.js';
import { parseGcsLocator, toGcsLocator } from './locator.js';
import type {
    CopyFileOptions,
    DownloadFileOptions,
    GetFileOptions,
    ObjectStorageAdapter,
    StoredFile,
    UploadFileOptions,
} from './types.js';

const log = createLogger('GcsStorageAdapter');
const REGULATORY_SOURCE_OBJECT = /^regulatory-sources\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[^/\\?#\u0000-\u001f\u007f]+$/;
const API_FINAL_CLEANUP_PROTOCOL = 'api-final-v1';

export interface ApiFinalObjectPlan {
    ownerId: string;
    cleanupToken: string;
    locator: string;
    objectName: string;
}

function safeName(value: string): string {
    const leaf = value.split(/[\\/]/).pop() || 'object';
    const normalized = leaf.normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[^\p{L}\p{N}._ -]+/gu, '_')
        .trim()
        .slice(0, 160);
    return normalized || 'object';
}

function safePrefix(value: string | undefined): string {
    const prefix = (value || 'uploads').replace(/^\/+|\/+$/g, '');
    if (!prefix || prefix.includes('\\') || prefix.split('/').some(part => !part || part === '..')) {
        throw new Error('Object folder is not canonical');
    }
    return prefix;
}

function isNotFound(error: unknown): boolean {
    return (error as { code?: number | string })?.code === 404;
}

function abortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error
        ? signal.reason
        : new Error('Cloud Storage operation aborted');
}

interface PromotionSourceIdentity {
    generation: string;
    size: string;
    crc32c: string;
    locatorSha256: string;
}

function requirePromotionSourceIdentity(
    locator: string,
    generation: string,
    metadata: Record<string, any>,
): PromotionSourceIdentity {
    if (String(metadata.generation || '') !== generation) {
        throw new Error('Quarantine metadata does not match the immutable source generation');
    }

    const size = String(metadata.size ?? '');
    const crc32c = typeof metadata.crc32c === 'string' ? metadata.crc32c : '';
    if (!/^\d+$/.test(size) || !/^[A-Za-z0-9+/]+={0,2}$/.test(crc32c)) {
        throw new Error('Quarantine object is missing a verifiable size or CRC32C checksum');
    }

    return {
        generation,
        size,
        crc32c,
        locatorSha256: createHash('sha256').update(locator, 'utf8').digest('hex'),
    };
}

function assertPromotedObjectIdentity(
    metadata: Record<string, any>,
    attachmentId: string,
    source: PromotionSourceIdentity,
): void {
    const custom = metadata.metadata || {};
    if (
        !/^\d+$/.test(String(metadata.generation || ''))
        || String(metadata.size ?? '') !== source.size
        || metadata.crc32c !== source.crc32c
        || custom.simsaAttachmentId !== attachmentId
        || custom.simsaSourceGeneration !== source.generation
        || custom.simsaSourceSize !== source.size
        || custom.simsaSourceCrc32c !== source.crc32c
        || custom.simsaSourceLocatorSha256 !== source.locatorSha256
    ) {
        throw new Error('Existing released object does not match the quarantine source identity');
    }
}

function apiFinalObjectMetadata(plan: ApiFinalObjectPlan): Record<string, string> {
    return {
        simsaCleanupProtocol: API_FINAL_CLEANUP_PROTOCOL,
        simsaCleanupToken: plan.cleanupToken,
        simsaOwnerId: plan.ownerId,
        simsaFinalLocatorSha256: createHash('sha256').update(plan.locator, 'utf8').digest('hex'),
    };
}

function assertApiFinalObjectIdentity(
    metadata: Record<string, any>,
    plan: ApiFinalObjectPlan,
): void {
    const custom = metadata.metadata || {};
    if (
        !/^\d+$/.test(String(metadata.generation || ''))
        || custom.simsaCleanupProtocol !== API_FINAL_CLEANUP_PROTOCOL
        || custom.simsaCleanupToken !== plan.cleanupToken
        || custom.simsaOwnerId !== plan.ownerId
        || custom.simsaFinalLocatorSha256
            !== createHash('sha256').update(plan.locator, 'utf8').digest('hex')
    ) {
        throw new Error('API-created final object does not match its durable cleanup identity');
    }
}

export class GcsStorageAdapter implements ObjectStorageAdapter {
    readonly provider = 'gcs' as const;

    constructor(
        private readonly storage: Storage,
        private readonly defaultBucket: string,
    ) {}

    static fromEnvironment(source: NodeJS.ProcessEnv = process.env): GcsStorageAdapter {
        const config = buildCloudPlatformConfig(source);
        const storageErrors = config.validationErrors.filter(error =>
            error.includes('GCS_') || error.includes('GOOGLE_CLOUD_PROJECT'),
        );
        if (config.storageProvider !== 'gcs') {
            throw new Error('OBJECT_STORAGE_PROVIDER must be gcs');
        }
        if (storageErrors.length > 0 || !config.gcsBucket) {
            throw new Error(`Invalid Cloud Storage configuration: ${storageErrors.join('; ')}`);
        }
        return new GcsStorageAdapter(
            new Storage(config.projectId ? { projectId: config.projectId } : undefined),
            config.gcsBucket,
        );
    }

    static uploadFromEnvironment(source: NodeJS.ProcessEnv = process.env): GcsStorageAdapter {
        const config = buildCloudPlatformConfig({ ...source, OBJECT_STORAGE_PROVIDER: 'gcs' });
        const storageErrors = config.validationErrors.filter(error =>
            error.includes('GCS_') || error.includes('GOOGLE_CLOUD_PROJECT'),
        );
        if (storageErrors.length > 0 || !config.gcsUploadBucket) {
            throw new Error(`Invalid Cloud Storage upload configuration: ${storageErrors.join('; ')}`);
        }
        return new GcsStorageAdapter(
            new Storage(config.projectId ? { projectId: config.projectId } : undefined),
            config.gcsUploadBucket,
        );
    }

    accepts(locator: string): boolean {
        try {
            parseGcsLocator(locator);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Probes the configured bucket without enumerating object names. Cloud
     * Storage does not currently expose an AbortSignal on getMetadata, so the
     * caller is released promptly while the SDK request settles in the
     * background under its own transport deadline.
     */
    async probeConnectivity(options: { abortSignal?: AbortSignal } = {}): Promise<void> {
        const signal = options.abortSignal;
        if (signal?.aborted) throw abortError(signal);

        const request = this.storage.bucket(this.defaultBucket).getMetadata();
        if (!signal) {
            await request;
            return;
        }

        let onAbort: (() => void) | undefined;
        const aborted = new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(abortError(signal));
            signal.addEventListener('abort', onAbort, { once: true });
            // Close the small race between the initial check and listener
            // registration while the SDK request was being constructed.
            if (signal.aborted) onAbort();
        });
        try {
            await Promise.race([request, aborted]);
        } finally {
            if (onAbort) signal.removeEventListener('abort', onAbort);
        }
    }

    /**
     * Non-mutating effective-IAM probe for one bucket. Cloud Storage's
     * testIamPermissions endpoint requires no additional IAM permission, so
     * readiness can prove both required capabilities and the absence of
     * dangerous drift without listing or creating an object.
     */
    async probeAccessContract(
        contract: { required: readonly string[]; forbidden: readonly string[] },
        options: { abortSignal?: AbortSignal } = {},
    ): Promise<void> {
        const required = [...new Set(contract.required)];
        const forbidden = [...new Set(contract.forbidden)];
        const allPermissions = [...new Set([...required, ...forbidden])];
        if (
            allPermissions.length === 0
            || allPermissions.some(permission => !/^storage\.[a-zA-Z]+\.[a-zA-Z]+$/.test(permission))
            || required.some(permission => forbidden.includes(permission))
        ) {
            throw new Error('Cloud Storage readiness permission contract is invalid');
        }

        const signal = options.abortSignal;
        if (signal?.aborted) throw abortError(signal);
        const request = this.storage.bucket(this.defaultBucket).iam.testPermissions(allPermissions);
        let onAbort: (() => void) | undefined;
        const aborted = new Promise<never>((_resolve, reject) => {
            if (!signal) return;
            onAbort = () => reject(abortError(signal));
            signal.addEventListener('abort', onAbort, { once: true });
            if (signal.aborted) onAbort();
        });
        try {
            const [effective] = signal
                ? await Promise.race([request, aborted])
                : await request;
            if (
                required.some(permission => effective[permission] !== true)
                || forbidden.some(permission => effective[permission] === true)
            ) {
                throw new Error('Cloud Storage runtime IAM contract is not least-privilege ready');
            }
        } finally {
            if (signal && onAbort) signal.removeEventListener('abort', onAbort);
        }
    }

    async createResumableUploadSession(options: {
        objectName: string;
        mimeType: string;
        sizeBytes: number;
        metadata: Record<string, string>;
        origin?: string;
    }): Promise<{ sessionUri: string; locator: string }> {
        const objectName = options.objectName.replace(/^\/+/, '');
        if (!objectName || objectName.includes('\\') || objectName.split('/').includes('..')) {
            throw new Error('Resumable upload object name is not canonical');
        }
        if (!Number.isSafeInteger(options.sizeBytes) || options.sizeBytes <= 0) {
            throw new Error('Resumable upload size must be a positive safe integer');
        }
        const file = this.storage.bucket(this.defaultBucket).file(objectName);
        const [sessionUri] = await file.createResumableUpload({
            origin: options.origin,
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: {
                // The SDK sends this as X-Upload-Content-Length when it creates
                // the session. GCS then rejects an oversized/undersized final
                // upload before Eventarc cleanup is needed.
                contentLength: options.sizeBytes,
                contentType: options.mimeType,
                cacheControl: 'private, no-store',
                metadata: options.metadata,
            },
        });
        return {
            sessionUri,
            locator: toGcsLocator(this.defaultBucket, objectName),
        };
    }

    private storedFile(
        bucket: string,
        objectName: string,
        metadata: Record<string, any>,
        fallbackName?: string,
    ): StoredFile {
        const locator = toGcsLocator(bucket, objectName);
        const originalName = metadata.metadata?.originalName;
        return {
            id: locator,
            name: typeof originalName === 'string'
                ? originalName
                : (fallbackName || objectName.split('/').pop() || 'object'),
            mimeType: metadata.contentType || 'application/octet-stream',
            url: locator,
            downloadUrl: locator,
            size: metadata.size === undefined ? undefined : Number(metadata.size),
            generation: metadata.generation === undefined ? undefined : String(metadata.generation),
            createdAt: typeof metadata.timeCreated === 'string' ? metadata.timeCreated : undefined,
            retentionExpiresAt: typeof metadata.retentionExpirationTime === 'string'
                ? metadata.retentionExpirationTime
                : undefined,
        };
    }

    async uploadFile(options: UploadFileOptions): Promise<StoredFile> {
        const fileName = safeName(options.fileName);
        const objectName = `${safePrefix(options.folder)}/${randomUUID()}-${fileName}`;
        const file = this.storage.bucket(this.defaultBucket).file(objectName);
        await file.save(options.buffer, {
            resumable: options.buffer.length >= 8 * 1024 * 1024,
            validation: 'crc32c',
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: {
                contentType: options.mimeType,
                cacheControl: 'private, no-store',
                metadata: { originalName: options.fileName },
            },
        });
        const [metadata] = await file.getMetadata();
        return this.storedFile(this.defaultBucket, objectName, metadata, options.fileName);
    }

    /**
     * Plan a unique final-bucket name before any bytes are created. The caller
     * must durably reserve this locator and token in PostgreSQL before calling
     * either write method below. That ordering closes the process-crash window
     * which would otherwise leave an untracked retention-locked object.
     */
    planApiFinalObject(options: {
        ownerId: string;
        fileName: string;
        folder?: string;
    }): ApiFinalObjectPlan {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.ownerId)) {
            throw new Error('API final-object owner ID must be a UUID');
        }
        const objectName = `${safePrefix(options.folder)}/${randomUUID()}-${safeName(options.fileName)}`;
        return {
            ownerId: options.ownerId.toLowerCase(),
            cleanupToken: randomUUID(),
            locator: toGcsLocator(this.defaultBucket, objectName),
            objectName,
        };
    }

    async uploadApiFinalObject(
        plan: ApiFinalObjectPlan,
        options: Omit<UploadFileOptions, 'folder'>,
    ): Promise<StoredFile> {
        if (toGcsLocator(this.defaultBucket, plan.objectName) !== plan.locator) {
            throw new Error('API final-object plan is outside the configured final bucket');
        }
        const file = this.storage.bucket(this.defaultBucket).file(plan.objectName);
        await file.save(options.buffer, {
            resumable: options.buffer.length >= 8 * 1024 * 1024,
            validation: 'crc32c',
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: {
                contentType: options.mimeType,
                cacheControl: 'private, no-store',
                metadata: {
                    originalName: options.fileName,
                    ...apiFinalObjectMetadata(plan),
                },
            },
        });
        const [metadata] = await file.getMetadata();
        assertApiFinalObjectIdentity(metadata, plan);
        return this.storedFile(this.defaultBucket, plan.objectName, metadata, options.fileName);
    }

    async copyApiFinalObject(
        plan: ApiFinalObjectPlan,
        options: Omit<CopyFileOptions, 'folder'>,
    ): Promise<StoredFile> {
        const source = parseGcsLocator(options.sourceUrl);
        if (!options.sourceGeneration || !/^\d+$/.test(options.sourceGeneration)) {
            throw new Error('Cloud Storage copy requires an immutable source generation');
        }
        if (toGcsLocator(this.defaultBucket, plan.objectName) !== plan.locator) {
            throw new Error('API final-object plan is outside the configured final bucket');
        }
        const destination = this.storage.bucket(this.defaultBucket).file(plan.objectName);
        await this.storage.bucket(source.bucket).file(source.objectName, {
            generation: options.sourceGeneration,
        }).copy(destination, {
            preconditionOpts: { ifGenerationMatch: 0 },
            contentType: options.mimeType,
            cacheControl: 'private, no-store',
            metadata: {
                originalName: options.fileName,
                ...apiFinalObjectMetadata(plan),
                simsaSourceGeneration: options.sourceGeneration,
                simsaSourceLocatorSha256: createHash('sha256')
                    .update(options.sourceUrl, 'utf8')
                    .digest('hex'),
            },
        });
        const [metadata] = await destination.getMetadata();
        assertApiFinalObjectIdentity(metadata, plan);
        return this.storedFile(this.defaultBucket, plan.objectName, metadata, options.fileName);
    }

    async copyFile(options: CopyFileOptions): Promise<StoredFile> {
        const source = parseGcsLocator(options.sourceUrl);
        if (!options.sourceGeneration || !/^\d+$/.test(options.sourceGeneration)) {
            throw new Error('Cloud Storage copy requires an immutable source generation');
        }
        const fileName = safeName(options.fileName);
        const objectName = `${safePrefix(options.folder)}/${randomUUID()}-${fileName}`;
        const destination = this.storage.bucket(this.defaultBucket).file(objectName);
        await this.storage.bucket(source.bucket).file(source.objectName, {
            generation: options.sourceGeneration,
        }).copy(destination, {
            preconditionOpts: { ifGenerationMatch: 0 },
            contentType: options.mimeType,
            cacheControl: 'private, no-store',
            metadata: { originalName: options.fileName },
        });
        const [metadata] = await destination.getMetadata();
        return this.storedFile(this.defaultBucket, objectName, metadata, options.fileName);
    }

    /**
     * Idempotently promotes one immutable quarantine generation to a stable,
     * deterministic final-object name. A retry after a process crash validates
     * the existing destination metadata instead of creating another copy.
     */
    async promoteQuarantinedObject(options: {
        sourceLocator: string;
        sourceGeneration: string;
        attachmentId: string;
        fileName: string;
        mimeType: string;
    }): Promise<StoredFile> {
        if (!/^\d+$/.test(options.sourceGeneration)) {
            throw new Error('Quarantine object generation is invalid');
        }
        const source = parseGcsLocator(options.sourceLocator);
        // Regulatory source locators are bound by a database constraint to the
        // rule-set namespace. Preserve an already-canonical path across the
        // quarantine/final bucket boundary; other attachment types retain the
        // collision-resistant released namespace.
        const destinationName = REGULATORY_SOURCE_OBJECT.test(source.objectName)
            ? source.objectName
            : [
                'released',
                options.attachmentId,
                `${options.sourceGeneration}-${safeName(options.fileName)}`,
            ].join('/');
        const destination = this.storage.bucket(this.defaultBucket).file(destinationName);
        const sourceFile = this.storage
            .bucket(source.bucket)
            .file(source.objectName, { generation: options.sourceGeneration });
        const [sourceMetadata] = await sourceFile.getMetadata();
        const sourceIdentity = requirePromotionSourceIdentity(
            options.sourceLocator,
            options.sourceGeneration,
            sourceMetadata,
        );
        const promotionMetadata = {
            simsaAttachmentId: options.attachmentId,
            simsaSourceGeneration: options.sourceGeneration,
            simsaSourceSize: sourceIdentity.size,
            simsaSourceCrc32c: sourceIdentity.crc32c,
            simsaSourceLocatorSha256: sourceIdentity.locatorSha256,
            originalName: options.fileName,
        };

        try {
            await sourceFile.copy(destination, {
                preconditionOpts: { ifGenerationMatch: 0 },
                contentType: options.mimeType,
                cacheControl: 'private, no-store',
                metadata: promotionMetadata,
            });
        } catch (error) {
            const code = (error as { code?: number | string })?.code;
            if (code !== 409 && code !== 412) throw error;
            const [existing] = await destination.getMetadata();
            assertPromotedObjectIdentity(existing, options.attachmentId, sourceIdentity);
        }

        const [metadata] = await destination.getMetadata();
        assertPromotedObjectIdentity(metadata, options.attachmentId, sourceIdentity);
        return this.storedFile(this.defaultBucket, destinationName, metadata, options.fileName);
    }

    /**
     * Deletes only a durable-queue candidate whose exact final generation and
     * promotion metadata still identify the scanner-produced copy. This is
     * intended for the isolated final-cleanup principal, never the API runtime.
     */
    async deletePromotedOrphan(options: {
        locator: string;
        generation: string;
        attachmentId: string;
        sourceLocator: string;
        sourceGeneration: string;
    }): Promise<'deleted' | 'not_found' | 'identity_mismatch'> {
        if (!/^\d+$/.test(options.generation) || !/^\d+$/.test(options.sourceGeneration)) {
            throw new Error('Promoted orphan generations are invalid');
        }
        const parsed = parseGcsLocator(options.locator);
        if (parsed.bucket !== this.defaultBucket) {
            throw new Error('Promoted orphan is outside the configured final bucket');
        }
        const expectedReleasedPrefix = `released/${options.attachmentId}/`;
        if (
            !parsed.objectName.startsWith(expectedReleasedPrefix)
            && !REGULATORY_SOURCE_OBJECT.test(parsed.objectName)
        ) {
            throw new Error('Promoted orphan object name is outside a releasable namespace');
        }

        const file = this.storage.bucket(parsed.bucket).file(parsed.objectName, {
            generation: options.generation,
        });
        let metadata: Record<string, any>;
        try {
            [metadata] = await file.getMetadata();
        } catch (error) {
            if (isNotFound(error)) return 'not_found';
            throw error;
        }

        const custom = metadata.metadata || {};
        const size = String(metadata.size ?? '');
        const crc32c = typeof metadata.crc32c === 'string' ? metadata.crc32c : '';
        const sourceLocatorSha256 = createHash('sha256')
            .update(options.sourceLocator, 'utf8')
            .digest('hex');
        if (
            String(metadata.generation || '') !== options.generation
            || !/^\d+$/.test(size)
            || !/^[A-Za-z0-9+/]+={0,2}$/.test(crc32c)
            || custom.simsaAttachmentId !== options.attachmentId
            || custom.simsaSourceGeneration !== options.sourceGeneration
            || custom.simsaSourceSize !== size
            || custom.simsaSourceCrc32c !== crc32c
            || custom.simsaSourceLocatorSha256 !== sourceLocatorSha256
        ) {
            return 'identity_mismatch';
        }

        await file.delete({ ignoreNotFound: true });
        return 'deleted';
    }

    /**
     * Resolve and delete an API-created candidate only when its unforgeable
     * reservation metadata still matches. A reservation can intentionally
     * omit the generation when the API crashed after GCS committed the object
     * but before PostgreSQL recorded the response; metadata supplies that
     * generation and deletion remains pinned to it.
     */
    async deleteApiFinalOrphan(options: {
        locator: string;
        generation: string | null;
        ownerId: string;
        cleanupToken: string;
    }): Promise<'deleted' | 'not_found' | 'identity_mismatch'> {
        if (options.generation !== null && !/^\d+$/.test(options.generation)) {
            throw new Error('API final-object generation is invalid');
        }
        const parsed = parseGcsLocator(options.locator);
        if (parsed.bucket !== this.defaultBucket) {
            throw new Error('API final-object orphan is outside the configured final bucket');
        }
        const plan: ApiFinalObjectPlan = {
            ownerId: options.ownerId,
            cleanupToken: options.cleanupToken,
            locator: options.locator,
            objectName: parsed.objectName,
        };
        const liveFile = this.storage.bucket(parsed.bucket).file(parsed.objectName);
        let metadata: Record<string, any>;
        try {
            [metadata] = await liveFile.getMetadata();
        } catch (error) {
            if (isNotFound(error)) return 'not_found';
            throw error;
        }
        try {
            assertApiFinalObjectIdentity(metadata, plan);
        } catch {
            return 'identity_mismatch';
        }
        const actualGeneration = String(metadata.generation || '');
        if (options.generation !== null && actualGeneration !== options.generation) {
            return 'identity_mismatch';
        }
        await this.storage
            .bucket(parsed.bucket)
            .file(parsed.objectName, { generation: actualGeneration })
            .delete({ ignoreNotFound: true });
        return 'deleted';
    }

    async getFile(locator: string, options: GetFileOptions = {}): Promise<StoredFile | null> {
        try {
            const parsed = parseGcsLocator(locator);
            if (options.generation && !/^\d+$/.test(options.generation)) {
                throw new Error('Cloud Storage generation is invalid');
            }
            const [metadata] = await this.storage.bucket(parsed.bucket).file(
                parsed.objectName,
                options.generation ? { generation: options.generation } : undefined,
            ).getMetadata();
            if (options.generation && String(metadata.generation || '') !== options.generation) {
                throw new Error('Cloud Storage returned a different object generation');
            }
            return this.storedFile(parsed.bucket, parsed.objectName, metadata);
        } catch (error) {
            if (isNotFound(error)) return null;
            log.error({ err: error, locator }, 'Failed to read Cloud Storage metadata');
            return null;
        }
    }

    async deleteFile(locator: string): Promise<boolean> {
        try {
            const parsed = parseGcsLocator(locator);
            await this.storage.bucket(parsed.bucket).file(parsed.objectName).delete({ ignoreNotFound: true });
            return true;
        } catch (error) {
            log.error({ err: error, locator }, 'Failed to delete Cloud Storage object');
            return false;
        }
    }

    /**
     * Deletes only the generation delivered by Eventarc. This must never fall
     * back to deleting the live object name: a delayed event must not remove a
     * newer generation that has since occupied the same name.
     */
    async deleteObjectGeneration(locator: string, generation: string): Promise<boolean> {
        if (!/^\d+$/.test(generation)) throw new Error('Cloud Storage generation is invalid');
        try {
            const parsed = parseGcsLocator(locator);
            await this.storage
                .bucket(parsed.bucket)
                .file(parsed.objectName, { generation })
                .delete({ ignoreNotFound: true });
            return true;
        } catch (error) {
            log.error({ err: error, locator, generation }, 'Failed to delete Cloud Storage generation');
            return false;
        }
    }

    async downloadFile(
        locator: string,
        options: DownloadFileOptions = {},
    ): Promise<{ stream: Readable; mimeType: string; fileName: string } | null> {
        try {
            const parsed = parseGcsLocator(locator);
            if (options.generation && !/^\d+$/.test(options.generation)) {
                throw new Error('Cloud Storage generation is invalid');
            }
            // Metadata and bytes must be read through the same immutable File
            // handle. Otherwise an overwrite between getMetadata and
            // createReadStream could scan one generation and promote another.
            const file = this.storage.bucket(parsed.bucket).file(
                parsed.objectName,
                options.generation ? { generation: options.generation } : undefined,
            );
            const [metadata] = await file.getMetadata();
            if (
                options.generation
                && String(metadata.generation || '') !== options.generation
            ) {
                throw new Error('Cloud Storage returned a different object generation');
            }
            const stream = file.createReadStream({ validation: true });
            const abort = () => stream.destroy(options.abortSignal?.reason instanceof Error
                ? options.abortSignal.reason
                : new Error('Cloud Storage download aborted'));
            if (options.abortSignal) {
                if (options.abortSignal.aborted) abort();
                else options.abortSignal.addEventListener('abort', abort, { once: true });
                stream.once('close', () => options.abortSignal?.removeEventListener('abort', abort));
            }
            return {
                stream,
                mimeType: metadata.contentType || 'application/octet-stream',
                fileName: typeof metadata.metadata?.originalName === 'string'
                    ? metadata.metadata.originalName
                    : (parsed.objectName.split('/').pop() || 'download'),
            };
        } catch (error) {
            if (isNotFound(error)) return null;
            log.error({ err: error, locator }, 'Failed to download Cloud Storage object');
            if (options.throwOnError) throw error;
            return null;
        }
    }

    async listFiles(
        prefix = 'uploads/',
        options: { abortSignal?: AbortSignal } = {},
    ): Promise<StoredFile[]> {
        if (options.abortSignal?.aborted) throw options.abortSignal.reason;
        const [files] = await this.storage.bucket(this.defaultBucket).getFiles({
            prefix,
            maxResults: 100,
            autoPaginate: false,
        });
        return Promise.all(files.map(async file => {
            if (options.abortSignal?.aborted) throw options.abortSignal.reason;
            const [metadata] = await file.getMetadata();
            return this.storedFile(this.defaultBucket, file.name, metadata);
        }));
    }
}
