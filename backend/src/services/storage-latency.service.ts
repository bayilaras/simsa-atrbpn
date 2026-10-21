import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { del, get, head, list, put } from '@vercel/blob';

/** Reserved prefix: never referenced by application records, deleted after each probe. */
export const STORAGE_LATENCY_PREFIX = '__simsa_latency_probe__/';
const MAX_PROBE_BYTES = 4 * 1024 * 1024;
const MAX_ROUNDS = 5;

export interface StorageLatencyClient {
    now(): number;
    put(pathname: string, body: Buffer): Promise<{ url: string }>;
    head(url: string): Promise<void>;
    get(url: string): Promise<Buffer>;
    del(url: string): Promise<void>;
    list(prefix: string): Promise<void>;
}

type Timing = { median: number; samples: number[] };
const timing = (samples: number[]): Timing => {
    const sorted = [...samples].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    return { median: Math.round(median), samples: samples.map(Math.round) };
};
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

/**
 * Measures, from inside the running function, how long the private store takes
 * to accept, describe, return and delete a probe object of each size, plus the
 * readiness probe's `list`. Operator-triggered only; it never touches records.
 */
export async function measureStorageLatency(client: StorageLatencyClient, options: { sizes: number[]; rounds: number }) {
    const { sizes, rounds } = options;
    if (sizes.length < 1 || sizes.length > 4 || !sizes.every(size => Number.isSafeInteger(size) && size >= 1 && size <= MAX_PROBE_BYTES)
        || !Number.isSafeInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) {
        throw new Error('Invalid storage latency probe');
    }
    const timed = async <T>(samples: number[], operation: () => Promise<T>): Promise<T> => {
        const startedAt = client.now();
        const result = await operation();
        samples.push(client.now() - startedAt);
        return result;
    };
    const listSamples: number[] = [];
    const results = [];
    for (const bytes of sizes) {
        const upload: number[] = [], metadata: number[] = [], download: number[] = [], removal: number[] = [];
        for (let round = 0; round < rounds; round++) {
            const body = randomBytes(bytes);
            const { url } = await timed(upload, () => client.put(`${STORAGE_LATENCY_PREFIX}${randomUUID()}.bin`, body));
            let deleted = false;
            try {
                await timed(metadata, () => client.head(url));
                const readBack = await timed(download, () => client.get(url));
                if (sha256(readBack) !== sha256(body)) throw new Error('Storage latency probe read back different bytes');
                await timed(removal, () => client.del(url));
                deleted = true;
            } finally {
                if (!deleted) await client.del(url).catch(() => undefined);
            }
        }
        results.push({ bytes, uploadMs: timing(upload), headMs: timing(metadata), downloadMs: timing(download), deleteMs: timing(removal) });
    }
    for (let round = 0; round < rounds; round++) await timed(listSamples, () => client.list(STORAGE_LATENCY_PREFIX));
    return { rounds, listMs: timing(listSamples), sizes: results };
}

/** The same SDK calls and options the Vercel Blob adapter uses for attachments. */
export const vercelBlobLatencyClient: StorageLatencyClient = {
    now: () => performance.now(),
    async put(pathname, body) {
        const blob = await put(pathname, body, { access: 'private', contentType: 'application/octet-stream',
            addRandomSuffix: true, allowOverwrite: false });
        return { url: blob.url };
    },
    async head(url) { await head(url); },
    async get(url) {
        const result = await get(url, { access: 'private', useCache: false });
        if (!result || result.statusCode !== 200 || !result.stream) throw new Error('Blob returned no content');
        const chunks: Uint8Array[] = [];
        const reader = result.stream.getReader();
        for (;;) {
            const next = await reader.read();
            if (next.done) break;
            chunks.push(next.value);
        }
        return Buffer.concat(chunks);
    },
    async del(url) { await del(url); },
    async list(prefix) { await list({ prefix, limit: 1 }); },
};
