import { describe, expect, it, vi } from 'vitest';
import {
    assertValidSrikandiEnvironment,
    buildSrikandiConfig,
    getSrikandiConfigurationStatus,
    srikandiConfig,
} from '../config/srikandi.js';
import {
    SrikandiConfigurationError,
    SrikandiDeliveryError,
    SrikandiHttpAdapter,
} from '../services/srikandi-http.adapter.js';
import {
    calculateSrikandiBackoffMs,
    computeSrikandiMessageHash,
    planSrikandiFailure,
} from '../services/srikandi.service.js';

const configuredEnvironment: NodeJS.ProcessEnv = {
    SRIKANDI_ENABLED: 'true',
    SRIKANDI_BASE_URL: 'https://srikandi.example.go.id',
    SRIKANDI_SYNC_PATH: '/official/v1/archive-events',
    SRIKANDI_API_TOKEN: 'test-secret-token',
    SRIKANDI_CONTRACT_VERSION: 'current-env-v2',
    SRIKANDI_ACK_FIELD: 'meta.ack',
    SRIKANDI_ACK_VALUE: 'ACCEPTED',
    SRIKANDI_REMOTE_ID_FIELD: 'data.id',
};

const message = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    idempotencyKey: 'arsip:550e8400-e29b-41d4-a716-446655440002:v1',
    contractVersion: 'queued-official-v1',
    eventType: 'archive.registered',
    unitKerjaId: 'ditjen',
    sourceEntityType: 'arsip',
    sourceEntityId: '550e8400-e29b-41d4-a716-446655440002',
    payload: { nomor: 'A-1' },
    createdAt: new Date('2026-08-25T00:00:00.000Z'),
};

describe('SRIKANDI configuration', () => {
    it('is disabled and not ready by default', () => {
        const config = buildSrikandiConfig({});
        expect(config).toMatchObject({ enabled: false, ready: false });
        expect(config.validationErrors).toEqual([]);
    });

    it('uses one initialized singleton for service and sanitized status consumers', () => {
        expect(getSrikandiConfigurationStatus()).toMatchObject({
            enabled: srikandiConfig.enabled,
            ready: srikandiConfig.ready,
        });
    });

    it('fails closed when explicitly enabled without the official contract settings', () => {
        const config = buildSrikandiConfig({ SRIKANDI_ENABLED: 'true' });
        expect(config.ready).toBe(false);
        expect(config.validationErrors.join(' ')).toContain('SRIKANDI_BASE_URL');
        expect(() => assertValidSrikandiEnvironment({ SRIKANDI_ENABLED: 'true' }))
            .toThrow(/Invalid SRIKANDI configuration/);
    });

    it('only becomes ready with HTTPS, credentials, and explicit response fields', () => {
        const config = buildSrikandiConfig(configuredEnvironment);
        expect(config).toMatchObject({ enabled: true, ready: true });
        expect(config.validationErrors).toEqual([]);

        expect(buildSrikandiConfig({
            ...configuredEnvironment,
            SRIKANDI_BASE_URL: 'http://srikandi.example.go.id',
        }).ready).toBe(false);

        const unsafeTimeout = buildSrikandiConfig({
            ...configuredEnvironment,
            SRIKANDI_TIMEOUT_MS: '45001',
        });
        expect(unsafeTimeout.ready).toBe(false);
        expect(unsafeTimeout.validationErrors.join(' ')).toContain('45000');
    });
});

describe('SRIKANDI HTTP adapter', () => {
    it('does not make a request while integration is disabled', async () => {
        const fetchMock = vi.fn();
        const adapter = new SrikandiHttpAdapter(buildSrikandiConfig({}), fetchMock as any);

        await expect(adapter.send(message)).rejects.toBeInstanceOf(SrikandiConfigurationError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('uses the queued contract snapshot and accepts only an official ACK and remote ID', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            meta: { ack: 'ACCEPTED' },
            data: { id: 'SRIKANDI-2026-001' },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        const adapter = new SrikandiHttpAdapter(
            buildSrikandiConfig(configuredEnvironment),
            fetchMock as any,
        );

        const result = await adapter.send(message);

        expect(result).toMatchObject({
            acknowledged: true,
            remoteId: 'SRIKANDI-2026-001',
            httpStatus: 200,
        });
        const [url, requestInit] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('https://srikandi.example.go.id/official/v1/archive-events');
        expect(requestInit.headers.Authorization).toBe('Bearer test-secret-token');
        expect(requestInit.headers['Idempotency-Key']).toBe(message.idempotencyKey);
        expect(requestInit.headers['X-SIMSA-Contract-Version']).toBe('queued-official-v1');
        expect(JSON.parse(requestInit.body)).toMatchObject({
            contractVersion: 'queued-official-v1',
            idempotencyKey: message.idempotencyKey,
            unitKerjaId: 'ditjen',
        });
    });

    it('rejects HTTP 2xx when the official acknowledgment is incomplete', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            meta: { ack: 'ACCEPTED' },
            data: {},
        }), { status: 200 }));
        const adapter = new SrikandiHttpAdapter(
            buildSrikandiConfig(configuredEnvironment),
            fetchMock as any,
        );

        const error = await adapter.send(message).catch(value => value);
        expect(error).toBeInstanceOf(SrikandiDeliveryError);
        expect(error.retryable).toBe(false);
        expect(error.message).toMatch(/ACK\/ID resmi/);
    });

    it('rejects an official remote ID longer than the durable column limit', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            meta: { ack: 'ACCEPTED' },
            data: { id: 'x'.repeat(256) },
        }), { status: 200 }));
        const adapter = new SrikandiHttpAdapter(
            buildSrikandiConfig(configuredEnvironment),
            fetchMock as any,
        );

        const error = await adapter.send(message).catch(value => value);
        expect(error).toBeInstanceOf(SrikandiDeliveryError);
        expect(error.retryable).toBe(false);
        expect(error.message).toContain('255');
    });

    it('enforces the 1 MiB cap incrementally when Content-Length is absent', async () => {
        const chunk = new Uint8Array(600 * 1024).fill(0x61);
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(chunk);
                controller.enqueue(chunk);
                controller.close();
            },
        });
        const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
        const adapter = new SrikandiHttpAdapter(
            buildSrikandiConfig(configuredEnvironment),
            fetchMock as any,
        );

        const error = await adapter.send(message).catch(value => value);
        expect(error).toBeInstanceOf(SrikandiDeliveryError);
        expect(error.retryable).toBe(false);
        expect(error.message).toContain('1 MiB');
    });

    it('keeps the abort timer active until the response body finishes', async () => {
        vi.useFakeTimers();
        try {
            let capturedSignal: AbortSignal | undefined;
            const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
                capturedSignal = init.signal as AbortSignal;
                const body = new ReadableStream<Uint8Array>({
                    start(controller) {
                        capturedSignal!.addEventListener('abort', () => {
                            controller.error(new DOMException('aborted', 'AbortError'));
                        }, { once: true });
                    },
                });
                return Promise.resolve(new Response(body, { status: 200 }));
            });
            const adapter = new SrikandiHttpAdapter(
                buildSrikandiConfig(configuredEnvironment),
                fetchMock as any,
            );

            const delivery = adapter.send(message).catch(value => value);
            await Promise.resolve();
            await Promise.resolve();
            await vi.advanceTimersByTimeAsync(15_000);

            expect(capturedSignal?.aborted).toBe(true);
            const error = await delivery;
            expect(error).toMatchObject({ retryable: true, httpStatus: 200 });
            expect(error.message).toMatch(/batas waktu/);
        } finally {
            vi.useRealTimers();
        }
    });

    it('derives JSON parser retryability from the HTTP status', async () => {
        const transientAdapter = new SrikandiHttpAdapter(
            buildSrikandiConfig(configuredEnvironment),
            vi.fn().mockResolvedValue(new Response('{invalid', { status: 503 })) as any,
        );
        const permanentAdapter = new SrikandiHttpAdapter(
            buildSrikandiConfig(configuredEnvironment),
            vi.fn().mockResolvedValue(new Response('{invalid', { status: 400 })) as any,
        );

        const transient = await transientAdapter.send(message).catch(value => value);
        const permanent = await permanentAdapter.send(message).catch(value => value);
        expect(transient).toMatchObject({ retryable: true, httpStatus: 503 });
        expect(permanent).toMatchObject({ retryable: false, httpStatus: 400 });
    });

    it('marks transient HTTP failures as retryable without fabricating success', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(
            JSON.stringify({ error: 'temporarily unavailable' }),
            { status: 503 },
        ));
        const adapter = new SrikandiHttpAdapter(
            buildSrikandiConfig(configuredEnvironment),
            fetchMock as any,
        );

        const error = await adapter.send(message).catch(value => value);
        expect(error).toBeInstanceOf(SrikandiDeliveryError);
        expect(error.retryable).toBe(true);
        expect(error.httpStatus).toBe(503);
    });
});

describe('SRIKANDI idempotency and backoff primitives', () => {
    it('hashes equivalent JSON payloads identically regardless of key order', () => {
        const base = {
            unitKerjaId: 'ditjen',
            idempotencyKey: 'archive:test:v1',
            contractVersion: 'official-v1',
            eventType: 'archive.registered',
            sourceEntityType: 'arsip',
            sourceEntityId: '550e8400-e29b-41d4-a716-446655440002',
        };
        const first = computeSrikandiMessageHash({ ...base, payload: { b: 2, a: { y: 1, x: 2 } } });
        const second = computeSrikandiMessageHash({ ...base, payload: { a: { x: 2, y: 1 }, b: 2 } });
        expect(first).toBe(second);

        const nextContract = computeSrikandiMessageHash({
            ...base,
            contractVersion: 'official-v2',
            payload: { a: { x: 2, y: 1 }, b: 2 },
        });
        expect(nextContract).not.toBe(first);
    });

    it('applies capped exponential retry backoff', () => {
        expect(calculateSrikandiBackoffMs(1, 60, 3_600)).toBe(60_000);
        expect(calculateSrikandiBackoffMs(3, 60, 3_600)).toBe(240_000);
        expect(calculateSrikandiBackoffMs(20, 60, 3_600)).toBe(3_600_000);
    });

    it('schedules transient failures and dead-letters permanent or exhausted failures', () => {
        const now = new Date('2026-08-26T00:00:00.000Z');
        expect(planSrikandiFailure(true, 2, 5, now, 60, 3_600)).toEqual({
            status: 'retry_scheduled',
            nextAttemptAt: new Date('2026-08-26T00:02:00.000Z'),
        });
        expect(planSrikandiFailure(false, 1, 5, now, 60, 3_600)).toEqual({
            status: 'dead_letter',
            nextAttemptAt: null,
        });
        expect(planSrikandiFailure(true, 5, 5, now, 60, 3_600)).toEqual({
            status: 'dead_letter',
            nextAttemptAt: null,
        });
    });
});
