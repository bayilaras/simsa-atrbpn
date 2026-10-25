import { createHash, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { ObjectStorageAdapter } from '../storage/types.js';

export interface BitstreamBaseline {
    fileUrl: string | null;
    driveFileId: string | null;
    objectGeneration: string | null;
    storageAccess: string;
    sha256: string | null;
    sizeBytes: number | null;
}

export class BitstreamInspectionError extends Error {
    constructor(public readonly code: string) {
        super(code);
        this.name = 'BitstreamInspectionError';
    }
}

/** Read only the recorded object version, with a deadline and streaming byte limit. */
export async function inspectBitstream(
    baseline: BitstreamBaseline,
    download: ObjectStorageAdapter['downloadFile'],
    limits = { maximumBytes: 64 * 1024 * 1024, timeoutMs: 30_000 },
) {
    const locator = baseline.fileUrl || baseline.driveFileId;
    if (!locator || baseline.storageAccess !== 'private'
        || !baseline.sha256 || !/^[a-f\d]{64}$/i.test(baseline.sha256)
        || !Number.isSafeInteger(baseline.sizeBytes) || baseline.sizeBytes! < 0
        || (locator.startsWith('gs://') && !/^\d+$/.test(baseline.objectGeneration || ''))) {
        throw new BitstreamInspectionError('BASELINE_INVALID');
    }
    if (!Number.isSafeInteger(limits.maximumBytes) || limits.maximumBytes < 1
        || !Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs < 1) {
        throw new BitstreamInspectionError('LIMITS_INVALID');
    }
    if (baseline.sizeBytes! > limits.maximumBytes) throw new BitstreamInspectionError('BYTE_LIMIT_EXCEEDED');

    const controller = new AbortController();
    let stream: Readable | undefined;
    let timeout: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
            const error = new BitstreamInspectionError('READ_TIMEOUT');
            controller.abort(error);
            stream?.destroy(error);
            reject(error);
        }, limits.timeoutMs);
    });
    const reading = (async () => {
        const result = await download(locator, {
            generation: baseline.objectGeneration || undefined,
            abortSignal: controller.signal,
            throwOnError: true,
        });
        if (controller.signal.aborted) {
            result?.stream.destroy();
            throw controller.signal.reason;
        }
        if (!result) throw new BitstreamInspectionError('OBJECT_UNAVAILABLE');
        stream = result.stream;
        const digest = createHash('sha256');
        let bytesRead = 0;
        for await (const value of stream) {
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
            bytesRead += chunk.length;
            if (bytesRead > limits.maximumBytes) throw new BitstreamInspectionError('BYTE_LIMIT_EXCEEDED');
            digest.update(chunk);
        }
        const actualHash = digest.digest('hex');
        return {
            expectedHash: baseline.sha256!,
            actualHash,
            bytesRead,
            matches: bytesRead === baseline.sizeBytes && timingSafeEqual(
                Buffer.from(baseline.sha256!, 'hex'), Buffer.from(actualHash, 'hex'),
            ),
        };
    })();
    try {
        return await Promise.race([reading, deadline]);
    } finally {
        clearTimeout(timeout!);
        // Includes error/overflow paths; a late metadata response checks abort above.
        controller.abort();
        stream?.destroy();
    }
}
