import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VercelBlobAdapter } from '../storage/vercel-blob.adapter.js';
import { GcsStorageAdapter } from '../storage/gcs.adapter.js';
const blob = vi.hoisted(() => ({ put: vi.fn(), head: vi.fn() }));
vi.mock('@vercel/blob', () => ({ ...blob, copy: vi.fn(), del: vi.fn(), get: vi.fn(), list: vi.fn() }));
vi.mock('../config/blob-storage.js', () => ({ buildBlobStorageConfig: () => ({ ready: true }) }));
const reservedName = 'bulk-upload/50000000-0000-4000-8000-000000000001/0.pdf';
const url = `https://fixture.private.blob.vercel-storage.com/${reservedName}`;
beforeEach(() => vi.clearAllMocks());

describe('reserved bulk object storage', () => {
    it('writes Vercel objects to the exact reserved name without overwrite or random suffix', async () => {
        blob.put.mockResolvedValue({ url, downloadUrl: url });
        const result = await new VercelBlobAdapter().uploadFile({
            fileName: 'original.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-'), reservedObjectName: reservedName,
        });
        expect(result.url).toBe(url);
        expect(blob.put).toHaveBeenCalledWith(reservedName, expect.any(Buffer), expect.objectContaining({
            access: 'private', addRandomSuffix: false, allowOverwrite: false,
        }));
    });
    it('looks up an exact Vercel name and refuses a foreign response namespace', async () => {
        blob.head.mockResolvedValueOnce({ url, downloadUrl: url, contentType: 'application/pdf', size: 5 });
        await expect(new VercelBlobAdapter().getFileByReservedName(reservedName)).resolves.toMatchObject({ url });
        expect(blob.head).toHaveBeenCalledWith(reservedName);
        blob.head.mockResolvedValueOnce({ url: 'https://fixture.private.blob.vercel-storage.com/other.pdf' });
        await expect(new VercelBlobAdapter().getFileByReservedName(reservedName)).rejects.toThrow('reserved bulk namespace');
    });
    it('pins the exact reserved GCS name and create-only generation precondition', async () => {
        const save = vi.fn().mockResolvedValue(undefined);
        const getMetadata = vi.fn().mockResolvedValue([{ generation: '1234', size: '5' }]);
        const file = vi.fn(() => ({ save, getMetadata }));
        const adapter = new GcsStorageAdapter({ bucket: vi.fn(() => ({ file })) } as never, 'simsa-upload');
        const result = await adapter.uploadFile({ fileName: 'original.pdf', mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-'), reservedObjectName: reservedName });
        expect(file).toHaveBeenCalledWith(reservedName);
        expect(save).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ preconditionOpts: { ifGenerationMatch: 0 } }));
        expect(result).toMatchObject({ url: `gs://simsa-upload/${reservedName}`, generation: '1234' });
        expect(await adapter.getFileByReservedName(reservedName)).toMatchObject({ generation: '1234' });
    });
    it.each(['../foreign.pdf', 'bulk-upload/not-a-uuid/0.pdf', reservedName.replace('/0.pdf', '/50.pdf')])(
        'rejects an unreserved object name %s before provider I/O', async invalid => {
            await expect(new VercelBlobAdapter().getFileByReservedName(invalid)).rejects.toThrow('bounded namespace');
            expect(blob.head).not.toHaveBeenCalled();
        });
});
