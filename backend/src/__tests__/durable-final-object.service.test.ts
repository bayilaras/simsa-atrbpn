import { describe, expect, it, vi } from 'vitest';
import { DurableFinalObjectService } from '../services/durable-final-object.service.js';
import type { StoredFile } from '../storage/types.js';

const ownerId = '10000000-0000-4000-8000-000000000001';
const stored: StoredFile = {
    id: 'https://store.private.blob.vercel-storage.com/final/report.pdf',
    name: 'report.pdf',
    mimeType: 'application/pdf',
    url: 'https://store.private.blob.vercel-storage.com/final/report.pdf',
    downloadUrl: 'https://store.private.blob.vercel-storage.com/final/report.pdf',
};
const upload = {
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF'),
    folder: 'autentikasi',
};
const copy = {
    sourceUrl: 'https://store.private.blob.vercel-storage.com/regulatory-sources/a/source.pdf',
    fileName: 'source.pdf',
    mimeType: 'application/pdf',
    folder: 'regulatory-sources/b',
};

function storage() {
    return {
        uploadFile: vi.fn().mockResolvedValue(stored),
        copyFile: vi.fn().mockResolvedValue(stored),
        deleteFile: vi.fn().mockResolvedValue(true),
    };
}

describe('API final-object writes on private Vercel Blob', () => {
    it('uploads and copies through the Blob facade', async () => {
        const blob = storage();
        const service = new DurableFinalObjectService({ provider: () => 'vercel-blob', storage: blob });

        await expect(service.upload(ownerId, upload)).resolves.toEqual({ stored });
        await expect(service.copy(ownerId, copy)).resolves.toEqual({ stored });
        expect(blob.uploadFile).toHaveBeenCalledExactlyOnceWith(upload);
        expect(blob.copyFile).toHaveBeenCalledExactlyOnceWith(copy);
    });

    it('deletes the immutable object created by a rolled-back transaction', async () => {
        const blob = storage();
        const service = new DurableFinalObjectService({ provider: () => 'vercel-blob', storage: blob });

        await service.compensate({ stored }, new Error('transaction rolled back'));
        await service.compensate(null, new Error('nothing written'));

        expect(blob.deleteFile).toHaveBeenCalledExactlyOnceWith(stored.url);
    });

    it('rejects disabled storage before any injected storage dependency can run', async () => {
        const blob = storage();
        const service = new DurableFinalObjectService({ provider: () => 'disabled', storage: blob });

        await expect(service.upload(ownerId, upload)).rejects.toMatchObject({ statusCode: 503 });
        await expect(service.copy(ownerId, copy)).rejects.toMatchObject({ statusCode: 503 });
        await expect(service.compensate({ stored }, new Error('rollback')))
            .rejects.toMatchObject({ statusCode: 503 });

        expect(blob.uploadFile).not.toHaveBeenCalled();
        expect(blob.copyFile).not.toHaveBeenCalled();
        expect(blob.deleteFile).not.toHaveBeenCalled();
    });
});
