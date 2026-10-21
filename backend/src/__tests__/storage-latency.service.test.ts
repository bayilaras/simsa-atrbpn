import { describe, expect, it, vi } from 'vitest';
import { measureStorageLatency, STORAGE_LATENCY_PREFIX, type StorageLatencyClient } from '../services/storage-latency.service.js';

const wallNow = Date.parse('2026-10-21T15:00:00Z');

function fakeClient(overrides: Partial<StorageLatencyClient> = {}) {
    const objects = new Map<string, { body: Buffer; uploadedAt: Date }>();
    let clock = 0;
    let serial = 0;
    const client: StorageLatencyClient = {
        now: () => clock,
        // Every operation "takes" a fixed, distinguishable time.
        put: vi.fn(async (pathname: string, body: Buffer) => {
            clock += 100;
            const url = `https://store.private.blob.vercel-storage.com/${pathname}-${serial++}`;
            objects.set(url, { body: Buffer.from(body), uploadedAt: new Date(wallNow) });
            return { url };
        }),
        head: vi.fn(async (url: string) => { clock += 10; if (!objects.has(url)) throw new Error('missing'); }),
        get: vi.fn(async (url: string) => { clock += 50; return objects.get(url)!.body; }),
        del: vi.fn(async (url: string) => { clock += 20; objects.delete(url); }),
        list: vi.fn(async (prefix: string) => {
            clock += 30;
            return [...objects].filter(([url]) => new URL(url).pathname.startsWith(`/${prefix}`))
                .map(([url, { uploadedAt }]) => ({ url, uploadedAt }));
        }),
        ...overrides,
    };
    const leftover = (ageMs: number) => {
        const url = `https://store.private.blob.vercel-storage.com/${STORAGE_LATENCY_PREFIX}leftover-${serial++}.bin`;
        objects.set(url, { body: Buffer.alloc(1), uploadedAt: new Date(wallNow - ageMs) });
        return url;
    };
    return { client, objects, leftover };
}
const options = (sizes: number[], rounds: number) => ({ sizes, rounds, now: () => wallNow });

describe('measureStorageLatency', () => {
    it('times upload, metadata, download, delete and list per size and leaves no object behind', async () => {
        const { client, objects } = fakeClient();
        const result = await measureStorageLatency(client, options([16, 1024], 3));
        expect(result).toEqual({
            rounds: 3,
            removedLeftovers: 0,
            listMs: { median: 30, samples: [30, 30, 30] },
            sizes: [16, 1024].map(bytes => ({ bytes,
                uploadMs: { median: 100, samples: [100, 100, 100] }, headMs: { median: 10, samples: [10, 10, 10] },
                downloadMs: { median: 50, samples: [50, 50, 50] }, deleteMs: { median: 20, samples: [20, 20, 20] } })),
        });
        expect(objects.size).toBe(0);
        for (const [pathname] of vi.mocked(client.put).mock.calls) expect(pathname.startsWith(STORAGE_LATENCY_PREFIX)).toBe(true);
        expect(client.list).toHaveBeenCalledWith(STORAGE_LATENCY_PREFIX);
    });

    it('removes probe objects orphaned by an earlier run but not those of a run still in flight', async () => {
        const { client, objects, leftover } = fakeClient();
        const orphan = leftover(5 * 60_000 + 1);
        const inFlight = leftover(60_000);
        const result = await measureStorageLatency(client, options([16], 1));
        expect(result.removedLeftovers).toBe(1);
        expect(objects.has(orphan)).toBe(false);
        expect([...objects.keys()]).toEqual([inFlight]);
    });

    it('still measures when the best-effort leftover sweep cannot list', async () => {
        const { client } = fakeClient();
        const list = vi.mocked(client.list);
        const realList = list.getMockImplementation()!;
        list.mockRejectedValueOnce(new Error('list unavailable')).mockImplementation(realList);
        await expect(measureStorageLatency(client, options([16], 1))).resolves.toMatchObject({ removedLeftovers: 0 });
    });

    it('fails when the downloaded bytes differ and still deletes the probe object', async () => {
        const { client, objects } = fakeClient({ get: vi.fn(async () => Buffer.from('tampered')) });
        await expect(measureStorageLatency(client, options([16], 1))).rejects.toThrow('Storage latency probe read back different bytes');
        expect(client.del).toHaveBeenCalledOnce();
        expect(objects.size).toBe(0);
    });

    it('deletes an uploaded probe object when a later step fails', async () => {
        const { client, objects } = fakeClient({ head: vi.fn(async () => { throw new Error('provider detail'); }) });
        await expect(measureStorageLatency(client, options([16], 1))).rejects.toThrow('provider detail');
        expect(objects.size).toBe(0);
    });

    it.each([[[], 1], [[0], 1], [[16], 0], [[16], 6], [[5 * 1024 * 1024], 1]])('rejects unbounded inputs (sizes %j, rounds %d)', async (sizes, rounds) => {
        const { client } = fakeClient();
        await expect(measureStorageLatency(client, options(sizes, rounds))).rejects.toThrow('Invalid storage latency probe');
        expect(client.put).not.toHaveBeenCalled();
        expect(client.list).not.toHaveBeenCalled();
    });
});
