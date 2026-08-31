import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { GcsStorageAdapter } from '../storage/gcs.adapter.js';

const SOURCE_GENERATION = '1735689600123456';
const SOURCE_SIZE = '4096';
const SOURCE_CRC32C = 'ImIEBA==';

function promotionSourceMetadata() {
    return {
        generation: SOURCE_GENERATION,
        size: SOURCE_SIZE,
        crc32c: SOURCE_CRC32C,
        contentType: 'application/pdf',
    };
}

function promotionCustomMetadata(sourceLocator: string, attachmentId: string) {
    return {
        simsaAttachmentId: attachmentId,
        simsaSourceGeneration: SOURCE_GENERATION,
        simsaSourceSize: SOURCE_SIZE,
        simsaSourceCrc32c: SOURCE_CRC32C,
        simsaSourceLocatorSha256: createHash('sha256').update(sourceLocator).digest('hex'),
        originalName: 'regulation.pdf',
    };
}

describe('GCS least-privilege copy', () => {
    it('binds a browser resumable session to the authorized content length', async () => {
        const createResumableUpload = vi.fn().mockResolvedValue([
            'https://storage.googleapis.test/resumable-session-secret',
        ]);
        const storage = {
            bucket: vi.fn().mockReturnValue({
                file: vi.fn().mockReturnValue({ createResumableUpload }),
            }),
        };
        const adapter = new GcsStorageAdapter(storage as never, 'simsa-upload');

        await adapter.createResumableUploadSession({
            objectName: 'surat-masuk/user/upload-arsip.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 4096,
            origin: 'https://simsa-preview.web.app',
            metadata: { simsaUploadId: 'upload-id' },
        });

        expect(createResumableUpload).toHaveBeenCalledWith({
            origin: 'https://simsa-preview.web.app',
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: {
                contentLength: 4096,
                contentType: 'application/pdf',
                cacheControl: 'private, no-store',
                metadata: { simsaUploadId: 'upload-id' },
            },
        });
    });

    it('probes bucket metadata without object listing and observes caller abort', async () => {
        const getMetadata = vi.fn(() => new Promise<never>(() => undefined));
        const getFiles = vi.fn();
        const storage = {
            bucket: vi.fn().mockReturnValue({ getMetadata, getFiles }),
        };
        const adapter = new GcsStorageAdapter(storage as never, 'simsa-final');
        const controller = new AbortController();

        const probe = adapter.probeConnectivity({ abortSignal: controller.signal });
        controller.abort(new Error('readiness deadline'));

        await expect(probe).rejects.toThrow('readiness deadline');
        expect(storage.bucket).toHaveBeenCalledWith('simsa-final');
        expect(getMetadata).toHaveBeenCalledOnce();
        expect(getFiles).not.toHaveBeenCalled();
    });

    it('fails readiness when effective bucket IAM is missing or broader than the contract', async () => {
        const testPermissions = vi.fn().mockResolvedValue([{
            'storage.objects.create': true,
            'storage.objects.get': true,
            'storage.objects.delete': true,
            'storage.objects.list': false,
        }, {}]);
        const storage = {
            bucket: vi.fn().mockReturnValue({ iam: { testPermissions } }),
        };
        const adapter = new GcsStorageAdapter(storage as never, 'simsa-final');

        await expect(adapter.probeAccessContract({
            required: ['storage.objects.create', 'storage.objects.get'],
            forbidden: ['storage.objects.delete', 'storage.objects.list'],
        })).rejects.toThrow(/not least-privilege ready/);
        expect(testPermissions).toHaveBeenCalledWith([
            'storage.objects.create',
            'storage.objects.get',
            'storage.objects.delete',
            'storage.objects.list',
        ]);

        testPermissions.mockResolvedValueOnce([{
            'storage.objects.create': true,
            'storage.objects.get': true,
            'storage.objects.delete': false,
            'storage.objects.list': false,
        }, {}]);
        await expect(adapter.probeAccessContract({
            required: ['storage.objects.create', 'storage.objects.get'],
            forbidden: ['storage.objects.delete', 'storage.objects.list'],
        })).resolves.toBeUndefined();
    });

    it('bounds an effective-IAM readiness probe with the caller abort signal', async () => {
        const testPermissions = vi.fn(() => new Promise<never>(() => undefined));
        const storage = {
            bucket: vi.fn().mockReturnValue({ iam: { testPermissions } }),
        };
        const adapter = new GcsStorageAdapter(storage as never, 'simsa-final');
        const controller = new AbortController();

        const probe = adapter.probeAccessContract({
            required: ['storage.objects.get'],
            forbidden: ['storage.objects.delete'],
        }, { abortSignal: controller.signal });
        controller.abort(new Error('readiness deadline'));

        await expect(probe).rejects.toThrow('readiness deadline');
    });

    it('sets destination metadata atomically without storage.objects.update', async () => {
        const destination = {
            getMetadata: vi.fn().mockResolvedValue([{
                generation: '1735689600999999',
                contentType: 'application/pdf',
                metadata: { originalName: 'regulation.pdf' },
            }]),
            setMetadata: vi.fn(),
        };
        const copy = vi.fn().mockResolvedValue([destination]);
        const sourceFile = { copy };
        const sourceBucket = { file: vi.fn().mockReturnValue(sourceFile) };
        const finalBucket = { file: vi.fn().mockReturnValue(destination) };
        const storage = {
            bucket: vi.fn((name: string) => (
                name === 'simsa-source' ? sourceBucket : finalBucket
            )),
        };
        const adapter = new GcsStorageAdapter(storage as never, 'simsa-final');

        const result = await adapter.copyFile({
            sourceUrl: 'gs://simsa-source/regulatory-sources/active.pdf',
            sourceGeneration: '1735689600123456',
            folder: 'regulatory-sources/draft-id',
            fileName: 'regulation.pdf',
            mimeType: 'application/pdf',
        });

        expect(sourceBucket.file).toHaveBeenCalledWith(
            'regulatory-sources/active.pdf',
            { generation: '1735689600123456' },
        );
        expect(copy).toHaveBeenCalledWith(destination, {
            preconditionOpts: { ifGenerationMatch: 0 },
            contentType: 'application/pdf',
            cacheControl: 'private, no-store',
            metadata: { originalName: 'regulation.pdf' },
        });
        expect(destination.setMetadata).not.toHaveBeenCalled();
        expect(destination.getMetadata).toHaveBeenCalledOnce();
        expect(result).toMatchObject({
            name: 'regulation.pdf',
            mimeType: 'application/pdf',
            generation: '1735689600999999',
        });
    });

    it('preserves a canonical regulatory namespace when promoting to the final bucket', async () => {
        const objectName = 'regulatory-sources/22222222-2222-4222-8222-222222222222/upload-regulation.pdf';
        const sourceLocator = `gs://simsa-upload/${objectName}`;
        const destination = {
            getMetadata: vi.fn().mockResolvedValue([{
                generation: '1735689600999999',
                size: SOURCE_SIZE,
                crc32c: SOURCE_CRC32C,
                contentType: 'application/pdf',
                metadata: promotionCustomMetadata(sourceLocator, 'attachment-regulatory'),
            }]),
        };
        const copy = vi.fn().mockResolvedValue([destination]);
        const sourceBucket = {
            file: vi.fn().mockReturnValue({
                copy,
                getMetadata: vi.fn().mockResolvedValue([promotionSourceMetadata()]),
            }),
        };
        const finalBucket = { file: vi.fn().mockReturnValue(destination) };
        const storage = {
            bucket: vi.fn((name: string) => (
                name === 'simsa-upload' ? sourceBucket : finalBucket
            )),
        };
        const adapter = new GcsStorageAdapter(storage as never, 'simsa-final');

        const result = await adapter.promoteQuarantinedObject({
            sourceLocator,
            sourceGeneration: SOURCE_GENERATION,
            attachmentId: 'attachment-regulatory',
            fileName: 'regulation.pdf',
            mimeType: 'application/pdf',
        });

        expect(finalBucket.file).toHaveBeenCalledWith(objectName);
        expect(copy).toHaveBeenCalledWith(destination, expect.objectContaining({
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: {
                simsaAttachmentId: 'attachment-regulatory',
                simsaSourceGeneration: SOURCE_GENERATION,
                simsaSourceSize: SOURCE_SIZE,
                simsaSourceCrc32c: SOURCE_CRC32C,
                simsaSourceLocatorSha256: createHash('sha256').update(sourceLocator).digest('hex'),
                originalName: 'regulation.pdf',
            },
        }));
        expect(result.url).toBe(`gs://simsa-final/${objectName}`);
    });

    it('accepts an idempotent regulatory promotion only when existing metadata matches', async () => {
        const objectName = 'regulatory-sources/22222222-2222-4222-8222-222222222222/upload-regulation.pdf';
        const sourceLocator = `gs://simsa-upload/${objectName}`;
        const matchingMetadata = {
            generation: '1735689600999999',
            size: SOURCE_SIZE,
            crc32c: SOURCE_CRC32C,
            contentType: 'application/pdf',
            metadata: promotionCustomMetadata(sourceLocator, 'attachment-regulatory'),
        };
        const destination = {
            getMetadata: vi.fn().mockResolvedValue([matchingMetadata]),
        };
        const copy = vi.fn().mockRejectedValue({ code: 412 });
        const sourceBucket = {
            file: vi.fn().mockReturnValue({
                copy,
                getMetadata: vi.fn().mockResolvedValue([promotionSourceMetadata()]),
            }),
        };
        const finalBucket = { file: vi.fn().mockReturnValue(destination) };
        const storage = {
            bucket: vi.fn((name: string) => (
                name === 'simsa-upload' ? sourceBucket : finalBucket
            )),
        };
        const adapter = new GcsStorageAdapter(storage as never, 'simsa-final');
        const input = {
            sourceLocator,
            sourceGeneration: SOURCE_GENERATION,
            attachmentId: 'attachment-regulatory',
            fileName: 'regulation.pdf',
            mimeType: 'application/pdf',
        };

        await expect(adapter.promoteQuarantinedObject(input)).resolves.toMatchObject({
            url: `gs://simsa-final/${objectName}`,
            generation: '1735689600999999',
        });

        destination.getMetadata.mockResolvedValueOnce([{
            ...matchingMetadata,
            metadata: {
                ...matchingMetadata.metadata,
                simsaSourceGeneration: 'different-generation',
            },
        }]);
        await expect(adapter.promoteQuarantinedObject(input)).rejects.toThrow(
            /does not match the quarantine source identity/,
        );
    });

    it.each([
        ['size', { size: '4097' }],
        ['CRC32C', { crc32c: 'AAAAAA==' }],
        ['destination generation', { generation: 'not-a-generation' }],
    ])('rejects a retry when the existing destination %s does not match', async (_field, override) => {
        const sourceLocator = 'gs://simsa-upload/surat-masuk/user/upload-record.pdf';
        const destination = {
            getMetadata: vi.fn().mockResolvedValue([{
                generation: '1735689600999999',
                size: SOURCE_SIZE,
                crc32c: SOURCE_CRC32C,
                contentType: 'application/pdf',
                metadata: promotionCustomMetadata(sourceLocator, 'attachment-general'),
                ...override,
            }]),
        };
        const sourceBucket = {
            file: vi.fn().mockReturnValue({
                copy: vi.fn().mockRejectedValue({ code: 412 }),
                getMetadata: vi.fn().mockResolvedValue([promotionSourceMetadata()]),
            }),
        };
        const storage = {
            bucket: vi.fn((name: string) => name === 'simsa-upload'
                ? sourceBucket
                : { file: vi.fn().mockReturnValue(destination) }),
        };

        await expect(new GcsStorageAdapter(storage as never, 'simsa-final')
            .promoteQuarantinedObject({
                sourceLocator,
                sourceGeneration: SOURCE_GENERATION,
                attachmentId: 'attachment-general',
                fileName: 'regulation.pdf',
                mimeType: 'application/pdf',
            })).rejects.toThrow(/does not match the quarantine source identity/);
    });

    it('fails closed before copy when pinned source metadata returns another generation', async () => {
        const copy = vi.fn();
        const sourceBucket = {
            file: vi.fn().mockReturnValue({
                copy,
                getMetadata: vi.fn().mockResolvedValue([{
                    ...promotionSourceMetadata(),
                    generation: '1735689600123457',
                }]),
            }),
        };
        const storage = {
            bucket: vi.fn((name: string) => name === 'simsa-upload'
                ? sourceBucket
                : { file: vi.fn() }),
        };

        await expect(new GcsStorageAdapter(storage as never, 'simsa-final')
            .promoteQuarantinedObject({
                sourceLocator: 'gs://simsa-upload/surat-masuk/user/upload-record.pdf',
                sourceGeneration: SOURCE_GENERATION,
                attachmentId: 'attachment-general',
                fileName: 'record.pdf',
                mimeType: 'application/pdf',
            })).rejects.toThrow(/immutable source generation/);
        expect(copy).not.toHaveBeenCalled();
    });

    it('keeps non-regulatory promotion under the released attachment namespace', async () => {
        const sourceLocator = 'gs://simsa-upload/surat-masuk/user/upload-record.pdf';
        const destination = {
            getMetadata: vi.fn().mockResolvedValue([{
                generation: '1735689600999999',
                size: SOURCE_SIZE,
                crc32c: SOURCE_CRC32C,
                contentType: 'application/pdf',
                metadata: {
                    ...promotionCustomMetadata(sourceLocator, 'attachment-general'),
                    originalName: 'record.pdf',
                },
            }]),
        };
        const sourceBucket = {
            file: vi.fn().mockReturnValue({
                copy: vi.fn().mockResolvedValue([destination]),
                getMetadata: vi.fn().mockResolvedValue([promotionSourceMetadata()]),
            }),
        };
        const finalBucket = { file: vi.fn().mockReturnValue(destination) };
        const storage = {
            bucket: vi.fn((name: string) => (
                name === 'simsa-upload' ? sourceBucket : finalBucket
            )),
        };
        const adapter = new GcsStorageAdapter(storage as never, 'simsa-final');

        await adapter.promoteQuarantinedObject({
            sourceLocator,
            sourceGeneration: SOURCE_GENERATION,
            attachmentId: 'attachment-general',
            fileName: 'record.pdf',
            mimeType: 'application/pdf',
        });

        expect(finalBucket.file).toHaveBeenCalledWith(
            'released/attachment-general/1735689600123456-record.pdf',
        );
    });

    it('lets the isolated cleanup authority delete only an exact self-consistent promotion', async () => {
        const sourceLocator = 'gs://simsa-upload/surat-masuk/user/upload-record.pdf';
        const attachmentId = '00000000-0000-4000-8000-000000000001';
        const objectName = `released/${attachmentId}/${SOURCE_GENERATION}-record.pdf`;
        const file = {
            getMetadata: vi.fn().mockResolvedValue([{
                generation: '1735689600999999',
                size: SOURCE_SIZE,
                crc32c: SOURCE_CRC32C,
                metadata: {
                    ...promotionCustomMetadata(sourceLocator, attachmentId),
                    originalName: 'record.pdf',
                },
            }]),
            delete: vi.fn().mockResolvedValue(undefined),
        };
        const bucket = { file: vi.fn().mockReturnValue(file) };
        const adapter = new GcsStorageAdapter({
            bucket: vi.fn().mockReturnValue(bucket),
        } as never, 'simsa-final');

        await expect(adapter.deletePromotedOrphan({
            locator: `gs://simsa-final/${objectName}`,
            generation: '1735689600999999',
            attachmentId,
            sourceLocator,
            sourceGeneration: SOURCE_GENERATION,
        })).resolves.toBe('deleted');
        expect(bucket.file).toHaveBeenCalledWith(objectName, {
            generation: '1735689600999999',
        });
        expect(file.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
    });

    it('refuses final cleanup when bytes or promotion identity no longer match', async () => {
        const sourceLocator = 'gs://simsa-upload/surat-masuk/user/upload-record.pdf';
        const attachmentId = '00000000-0000-4000-8000-000000000001';
        const file = {
            getMetadata: vi.fn().mockResolvedValue([{
                generation: '1735689600999999',
                size: SOURCE_SIZE,
                crc32c: 'AAAAAA==',
                metadata: promotionCustomMetadata(sourceLocator, attachmentId),
            }]),
            delete: vi.fn(),
        };
        const adapter = new GcsStorageAdapter({
            bucket: vi.fn().mockReturnValue({ file: vi.fn().mockReturnValue(file) }),
        } as never, 'simsa-final');

        await expect(adapter.deletePromotedOrphan({
            locator: `gs://simsa-final/released/${attachmentId}/${SOURCE_GENERATION}-record.pdf`,
            generation: '1735689600999999',
            attachmentId,
            sourceLocator,
            sourceGeneration: SOURCE_GENERATION,
        })).resolves.toBe('identity_mismatch');
        expect(file.delete).not.toHaveBeenCalled();
    });

    it('writes API final objects with a pre-reserved cleanup token in immutable metadata', async () => {
        const ownerId = '00000000-0000-4000-8000-000000000001';
        const cleanupToken = '00000000-0000-4000-8000-000000000002';
        const objectName = 'autentikasi/queued.pdf';
        const locator = `gs://simsa-final/${objectName}`;
        const expectedMetadata = {
            originalName: 'queued.pdf',
            simsaCleanupProtocol: 'api-final-v1',
            simsaCleanupToken: cleanupToken,
            simsaOwnerId: ownerId,
            simsaFinalLocatorSha256: createHash('sha256').update(locator).digest('hex'),
        };
        const file = {
            save: vi.fn().mockResolvedValue(undefined),
            getMetadata: vi.fn().mockResolvedValue([{
                generation: '1735689600999999',
                contentType: 'application/pdf',
                metadata: expectedMetadata,
            }]),
        };
        const adapter = new GcsStorageAdapter({
            bucket: vi.fn().mockReturnValue({ file: vi.fn().mockReturnValue(file) }),
        } as never, 'simsa-final');

        const result = await adapter.uploadApiFinalObject({
            ownerId,
            cleanupToken,
            locator,
            objectName,
        }, {
            fileName: 'queued.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF'),
        });

        expect(file.save).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: expect.objectContaining({ metadata: expectedMetadata }),
        }));
        expect(result).toMatchObject({ url: locator, generation: '1735689600999999' });
    });

    it('lets cleanup recover a crashed write generation only when reservation metadata matches', async () => {
        const ownerId = '00000000-0000-4000-8000-000000000001';
        const cleanupToken = '00000000-0000-4000-8000-000000000002';
        const objectName = 'autentikasi/queued.pdf';
        const locator = `gs://simsa-final/${objectName}`;
        const exact = { delete: vi.fn().mockResolvedValue(undefined) };
        const live = {
            getMetadata: vi.fn().mockResolvedValue([{
                generation: '1735689600999999',
                metadata: {
                    simsaCleanupProtocol: 'api-final-v1',
                    simsaCleanupToken: cleanupToken,
                    simsaOwnerId: ownerId,
                    simsaFinalLocatorSha256: createHash('sha256').update(locator).digest('hex'),
                },
            }]),
        };
        const file = vi.fn((_name: string, options?: { generation?: string }) => (
            options?.generation ? exact : live
        ));
        const adapter = new GcsStorageAdapter({
            bucket: vi.fn().mockReturnValue({ file }),
        } as never, 'simsa-final');

        await expect(adapter.deleteApiFinalOrphan({
            locator,
            generation: null,
            ownerId,
            cleanupToken,
        })).resolves.toBe('deleted');
        expect(file).toHaveBeenLastCalledWith(objectName, { generation: '1735689600999999' });
        expect(exact.delete).toHaveBeenCalledWith({ ignoreNotFound: true });

        live.getMetadata.mockResolvedValueOnce([{
            generation: '1735689600999999',
            metadata: {
                simsaCleanupProtocol: 'api-final-v1',
                simsaCleanupToken: '00000000-0000-4000-8000-000000000099',
                simsaOwnerId: ownerId,
                simsaFinalLocatorSha256: createHash('sha256').update(locator).digest('hex'),
            },
        }]);
        await expect(adapter.deleteApiFinalOrphan({
            locator,
            generation: null,
            ownerId,
            cleanupToken,
        })).resolves.toBe('identity_mismatch');
        expect(exact.delete).toHaveBeenCalledTimes(1);
    });
});
