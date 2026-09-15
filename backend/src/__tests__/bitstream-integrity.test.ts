import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { inspectBitstream } from '../services/bitstream-integrity.js';

const bytes = Buffer.from('arsip asli');
const baseline = {
    fileUrl: 'gs://simsa-private/arsip/original.pdf',
    driveFileId: null,
    objectGeneration: '12345',
    storageAccess: 'private',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
};
const response = (stream: Readable) => ({ stream, mimeType: 'application/pdf', fileName: 'original.pdf' });

describe('bounded bitstream integrity inspection', () => {
    it('verifies exact bytes and pins the stored object generation', async () => {
        const download = vi.fn().mockResolvedValue(response(Readable.from([bytes])));
        const result = await inspectBitstream(baseline, download);
        expect(result).toMatchObject({ matches: true, actualHash: baseline.sha256, bytesRead: bytes.length });
        expect(download).toHaveBeenCalledWith(baseline.fileUrl, expect.objectContaining({ generation: '12345', throwOnError: true }));
    });

    it('does not verify a different byte sequence or an inconsistent recorded size', async () => {
        const changed = await inspectBitstream(baseline, async () => response(Readable.from(['arsip palsu'])));
        expect(changed.matches).toBe(false);
        const wrongSize = await inspectBitstream({ ...baseline, sizeBytes: bytes.length + 1 }, async () => response(Readable.from([bytes])));
        expect(wrongSize.matches).toBe(false);
    });

    it.each([
        { ...baseline, storageAccess: 'public' },
        { ...baseline, sha256: null },
        { ...baseline, sizeBytes: null },
        { ...baseline, objectGeneration: null },
    ])('rejects an uncontrolled or incomplete baseline before reading', async (record) => {
        const download = vi.fn();
        await expect(inspectBitstream(record, download)).rejects.toThrow();
        expect(download).not.toHaveBeenCalled();
    });

    it('stops an oversized stream even when its reported size is small', async () => {
        const stream = Readable.from([Buffer.alloc(32)]);
        await expect(inspectBitstream(baseline, async () => response(stream), { maximumBytes: 16, timeoutMs: 1000 }))
            .rejects.toMatchObject({ code: 'BYTE_LIMIT_EXCEEDED' });
        expect(stream.destroyed).toBe(true);
    });

    it('aborts and closes a stalled stream at the deadline', async () => {
        const stream = new Readable({ read() {} });
        let signal: AbortSignal | undefined;
        await expect(inspectBitstream(baseline, async (_locator, options) => {
            signal = options?.abortSignal;
            return response(stream);
        }, { maximumBytes: 1024, timeoutMs: 25 })).rejects.toMatchObject({ code: 'READ_TIMEOUT' });
        expect(signal?.aborted).toBe(true);
        expect(stream.destroyed).toBe(true);
    });

    it('bounds waiting for metadata and closes a download that resolves after timeout', async () => {
        let resolveDownload!: (value: ReturnType<typeof response>) => void;
        const download = new Promise<ReturnType<typeof response>>(resolve => { resolveDownload = resolve; });
        await expect(inspectBitstream(baseline, () => download, { maximumBytes: 1024, timeoutMs: 25 }))
            .rejects.toMatchObject({ code: 'READ_TIMEOUT' });
        const stream = Readable.from([bytes]);
        resolveDownload(response(stream));
        await new Promise(resolve => setImmediate(resolve));
        expect(stream.destroyed).toBe(true);
    });
});
