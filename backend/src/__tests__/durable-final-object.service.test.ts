import { describe, expect, it, vi } from 'vitest';
import {
    DurableFinalObjectService,
    type ApiFinalObjectRepository,
    type DurableFinalObjectCandidate,
} from '../services/durable-final-object.service.js';
import type { ApiFinalObjectPlan } from '../storage/gcs.adapter.js';
import type { StoredFile } from '../storage/types.js';

const plan: ApiFinalObjectPlan = {
    ownerId: '10000000-0000-4000-8000-000000000001',
    cleanupToken: '20000000-0000-4000-8000-000000000001',
    locator: 'gs://simsa-final/autentikasi/queued.pdf',
    objectName: 'autentikasi/queued.pdf',
};

function dependencies(options: { record?: boolean } = {}) {
    const calls: string[] = [];
    const repository: ApiFinalObjectRepository = {
        reserve: vi.fn(async () => {
            calls.push('reserve');
            return true;
        }),
        record: vi.fn(async () => {
            calls.push('record');
            return options.record ?? true;
        }),
        markReferenced: vi.fn(async () => {
            calls.push('mark');
            return true;
        }),
    };
    const storage = {
        planApiFinalObject: vi.fn(() => plan),
        uploadApiFinalObject: vi.fn(async () => {
            calls.push('write');
            return {
                id: plan.locator,
                name: 'queued.pdf',
                mimeType: 'application/pdf',
                url: plan.locator,
                downloadUrl: plan.locator,
                generation: '1735689600123456',
            };
        }),
    };
    const legacy = {
        uploadFile: vi.fn(),
        copyFile: vi.fn(),
        deleteFile: vi.fn().mockResolvedValue(true),
    };
    const service = new DurableFinalObjectService({
        provider: () => 'gcs',
        repository,
        gcs: () => storage as any,
        now: () => new Date('2026-08-31T00:00:00.000Z'),
        minimumObjectAgeMs: () => 31 * 24 * 60 * 60_000,
        legacy,
    });
    return { calls, repository, storage, legacy, service };
}

describe('durable API final-object writes', () => {
    it('reserves before GCS creation, records the exact generation, then binds inside the domain transaction', async () => {
        const { calls, repository, service } = dependencies();
        const write = await service.upload(plan.ownerId, {
            fileName: 'queued.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF'),
            folder: 'autentikasi',
        });

        expect(calls).toEqual(['reserve', 'write', 'record']);
        expect(write.candidate).toMatchObject({
            cleanupToken: plan.cleanupToken,
            locator: plan.locator,
            generation: '1735689600123456',
        });
        expect(repository.record).toHaveBeenCalledWith(
            plan,
            '1735689600123456',
            new Date('2026-10-01T00:00:00.000Z'),
        );

        const executor = { execute: vi.fn() };
        await service.markReferenced(executor, write);
        expect(calls).toEqual(['reserve', 'write', 'record', 'mark']);
        expect(repository.markReferenced).toHaveBeenCalledWith(executor, write.candidate);
    });

    it('keeps the pre-write reservation recoverable when generation persistence fails', async () => {
        const { calls, legacy, service } = dependencies({ record: false });

        await expect(service.upload(plan.ownerId, {
            fileName: 'queued.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF'),
            folder: 'autentikasi',
        })).rejects.toThrow(/record the final object generation/i);

        expect(calls).toEqual(['reserve', 'write', 'record']);
        expect(legacy.deleteFile).not.toHaveBeenCalled();
    });

    it('never asks the API principal to delete a queued GCS candidate after rollback', async () => {
        const { legacy, service } = dependencies();
        const candidate: DurableFinalObjectCandidate = {
            provider: 'gcs',
            ownerId: plan.ownerId,
            cleanupToken: plan.cleanupToken,
            locator: plan.locator,
            generation: '1735689600123456',
        };

        await service.compensate({
            stored: {
                id: plan.locator,
                name: 'queued.pdf',
                mimeType: 'application/pdf',
                url: plan.locator,
                downloadUrl: plan.locator,
                generation: candidate.generation,
            },
            candidate,
        }, new Error('transaction rolled back'));

        expect(legacy.deleteFile).not.toHaveBeenCalled();
    });

    it('keeps the legacy provider behaviour unchanged outside metadata-only demo mode', async () => {
        const stored: StoredFile = {
            id: 'https://store.private.blob.vercel-storage.com/final/report.pdf',
            name: 'report.pdf',
            mimeType: 'application/pdf',
            url: 'https://store.private.blob.vercel-storage.com/final/report.pdf',
            downloadUrl: 'https://store.private.blob.vercel-storage.com/final/report.pdf',
        };
        const legacy = {
            uploadFile: vi.fn().mockResolvedValue(stored),
            copyFile: vi.fn().mockResolvedValue(stored),
            deleteFile: vi.fn().mockResolvedValue(true),
        };
        const gcs = vi.fn();
        const repository: ApiFinalObjectRepository = {
            reserve: vi.fn(),
            record: vi.fn(),
            markReferenced: vi.fn(),
        };
        const service = new DurableFinalObjectService({
            provider: () => 'vercel-blob',
            legacy,
            gcs,
            repository,
        });

        const write = await service.upload(plan.ownerId, {
            fileName: 'report.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF'),
            folder: 'autentikasi',
        });
        expect(write).toEqual({ stored, candidate: null });
        expect(legacy.uploadFile).toHaveBeenCalledOnce();
        expect(gcs).not.toHaveBeenCalled();
        expect(repository.reserve).not.toHaveBeenCalled();
    });

    it('rejects disabled storage before any injected GCS, repository, or legacy dependency can run', async () => {
        const repository: ApiFinalObjectRepository = {
            reserve: vi.fn(),
            record: vi.fn(),
            markReferenced: vi.fn(),
        };
        const legacy = {
            uploadFile: vi.fn(),
            copyFile: vi.fn(),
            deleteFile: vi.fn(),
        };
        const gcs = vi.fn();
        const minimumObjectAgeMs = vi.fn(() => 1);
        const service = new DurableFinalObjectService({
            provider: () => 'disabled',
            repository,
            legacy,
            gcs,
            minimumObjectAgeMs,
        });
        const upload = {
            fileName: 'blocked.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF'),
            folder: 'autentikasi',
        };

        await expect(service.upload(plan.ownerId, upload)).rejects.toMatchObject({ statusCode: 503 });
        await expect(service.copy(plan.ownerId, {
            sourceUrl: plan.locator,
            sourceGeneration: '1',
            fileName: 'blocked.pdf',
            mimeType: 'application/pdf',
            folder: 'autentikasi',
        })).rejects.toMatchObject({ statusCode: 503 });

        expect(gcs).not.toHaveBeenCalled();
        expect(minimumObjectAgeMs).not.toHaveBeenCalled();
        expect(repository.reserve).not.toHaveBeenCalled();
        expect(repository.record).not.toHaveBeenCalled();
        expect(legacy.uploadFile).not.toHaveBeenCalled();
        expect(legacy.copyFile).not.toHaveBeenCalled();
    });

    it('rejects disabled storage before injected reference or compensation I/O', async () => {
        const repository: ApiFinalObjectRepository = {
            reserve: vi.fn(),
            record: vi.fn(),
            markReferenced: vi.fn(),
        };
        const legacy = {
            uploadFile: vi.fn(),
            copyFile: vi.fn(),
            deleteFile: vi.fn(),
        };
        const service = new DurableFinalObjectService({
            provider: () => 'disabled',
            repository,
            legacy,
        });
        const candidate: DurableFinalObjectCandidate = {
            provider: 'gcs',
            ownerId: plan.ownerId,
            cleanupToken: plan.cleanupToken,
            locator: plan.locator,
            generation: '1735689600123456',
        };
        const legacyWrite = {
            stored: {
                id: 'legacy',
                name: 'legacy.pdf',
                mimeType: 'application/pdf',
                url: 'https://store.private.blob.vercel-storage.com/final/legacy.pdf',
                downloadUrl: 'https://store.private.blob.vercel-storage.com/final/legacy.pdf',
            },
            candidate: null,
        };

        await expect(service.markReferenced({ execute: vi.fn() }, {
            stored: legacyWrite.stored,
            candidate,
        })).rejects.toMatchObject({ statusCode: 503 });
        await expect(service.compensate(legacyWrite, new Error('rollback')))
            .rejects.toMatchObject({ statusCode: 503 });

        expect(repository.markReferenced).not.toHaveBeenCalled();
        expect(legacy.deleteFile).not.toHaveBeenCalled();
    });
});
