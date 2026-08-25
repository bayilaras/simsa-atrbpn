import { describe, expect, it, vi } from 'vitest';
import { buildSrikandiConfig } from '../config/srikandi.js';

vi.mock('../utils/logger.js', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

const { SrikandiWorker } = await import('../services/srikandi.worker.js');

const readyWorkerConfig = buildSrikandiConfig({
    SRIKANDI_ENABLED: 'true',
    SRIKANDI_BASE_URL: 'https://srikandi.example.go.id',
    SRIKANDI_SYNC_PATH: '/official/v1/archive-events',
    SRIKANDI_API_TOKEN: 'test-secret-token',
    SRIKANDI_CONTRACT_VERSION: 'official-v1',
    SRIKANDI_ACK_FIELD: 'meta.ack',
    SRIKANDI_ACK_VALUE: 'ACCEPTED',
    SRIKANDI_REMOTE_ID_FIELD: 'data.id',
    SRIKANDI_WORKER_BATCH_SIZE: '7',
    SRIKANDI_WORKER_POLL_MS: '500',
});

describe('persistent SRIKANDI worker', () => {
    it('fails closed without a complete enabled integration configuration', async () => {
        const service = { dispatchDue: vi.fn() };
        const worker = new SrikandiWorker(service, buildSrikandiConfig({}));

        await expect(worker.runOnce()).rejects.toMatchObject({ statusCode: 503 });
        expect(service.dispatchDue).not.toHaveBeenCalled();
    });

    it('processes an all-unit batch through atomic service claims', async () => {
        const results = [{ outcome: 'succeeded', item: { id: 'outbox-1' } }] as any;
        const service = { dispatchDue: vi.fn().mockResolvedValue(results) };
        const worker = new SrikandiWorker(service, readyWorkerConfig);

        await expect(worker.runOnce()).resolves.toBe(results);
        expect(service.dispatchDue).toHaveBeenCalledWith(null, 7);
    });

    it('runs persistently and stops its pending poll without another dispatch', async () => {
        const service = { dispatchDue: vi.fn().mockResolvedValue([]) };
        const worker = new SrikandiWorker(service, readyWorkerConfig);

        const running = worker.start();
        await vi.waitFor(() => expect(service.dispatchDue).toHaveBeenCalledOnce());
        await worker.stop();
        await running;

        expect(service.dispatchDue).toHaveBeenCalledOnce();
    });
});
