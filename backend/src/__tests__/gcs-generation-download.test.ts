import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { GcsStorageAdapter } from '../storage/gcs.adapter.js';

describe('GCS immutable generation download', () => {
    it('pins metadata and byte stream to the requested generation', async () => {
        const stream = Readable.from([Buffer.from('immutable')]);
        const file = {
            getMetadata: vi.fn().mockResolvedValue([{
                generation: '1735689600123456',
                contentType: 'application/pdf',
                metadata: { originalName: 'record.pdf' },
            }]),
            createReadStream: vi.fn().mockReturnValue(stream),
        };
        const bucket = { file: vi.fn().mockReturnValue(file) };
        const storage = { bucket: vi.fn().mockReturnValue(bucket) };
        const adapter = new GcsStorageAdapter(storage as never, 'simsa-final');

        const result = await adapter.downloadFile(
            'gs://simsa-upload/surat-masuk/record.pdf',
            { generation: '1735689600123456', throwOnError: true },
        );

        expect(bucket.file).toHaveBeenCalledWith(
            'surat-masuk/record.pdf',
            { generation: '1735689600123456' },
        );
        expect(file.getMetadata).toHaveBeenCalledOnce();
        expect(file.createReadStream).toHaveBeenCalledWith({ validation: true });
        expect(result?.stream).toBe(stream);
    });
});
