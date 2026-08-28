import { describe, expect, it, vi } from 'vitest';
import { buildSrikandiConfig } from '../config/srikandi.js';
import { SrikandiBusinessProducer } from '../services/srikandi-producer.service.js';

const record = {
    id: '550e8400-e29b-41d4-a716-446655440010',
    unitKerjaId: 'ditjen',
    nomorSurat: 'SM-1/2026',
    tanggalSurat: '2026-08-28',
    perihal: 'Pengujian producer',
    counterpart: 'Unit eksternal',
    createdAt: new Date('2026-08-28T00:00:00Z'),
};

const readyConfig = () => buildSrikandiConfig({
    SRIKANDI_ENABLED: 'false',
    SRIKANDI_PRODUCER_ENABLED: 'true',
    SRIKANDI_CONTRACT_VERSION: 'operator-confirmed-v1',
    SRIKANDI_PRODUCER_PAYLOAD_PROFILE: 'simsa-record-v1',
    SRIKANDI_SURAT_MASUK_CREATED_EVENT: 'official.incoming.created',
    SRIKANDI_SURAT_KELUAR_CREATED_EVENT: 'official.outgoing.created',
});

describe('SRIKANDI business producer gating', () => {
    it('is a no-op while the producer is disabled', async () => {
        const outbox = { enqueueWithExecutor: vi.fn() };
        const producer = new SrikandiBusinessProducer(buildSrikandiConfig({}), outbox as any);

        await expect(producer.suratMasukCreated({}, record)).resolves.toEqual({
            queued: false,
            reason: 'disabled',
        });
        expect(outbox.enqueueWithExecutor).not.toHaveBeenCalled();
    });

    it('uses the caller transaction and explicitly configured event mapping', async () => {
        const executor = { transactionMarker: true };
        const outbox = { enqueueWithExecutor: vi.fn().mockResolvedValue({}) };
        const producer = new SrikandiBusinessProducer(readyConfig(), outbox as any);

        await expect(producer.suratMasukCreated(executor, record, 'actor-1'))
            .resolves.toEqual({ queued: true });
        expect(outbox.enqueueWithExecutor).toHaveBeenCalledWith(
            executor,
            expect.objectContaining({
                eventType: 'official.incoming.created',
                sourceEntityType: 'surat_masuk',
                sourceEntityId: record.id,
                payload: expect.objectContaining({ profile: 'simsa-record-v1' }),
            }),
        );
    });

    it('serializes a Date tanggalSurat as an ISO calendar date', async () => {
        const outbox = { enqueueWithExecutor: vi.fn().mockResolvedValue({}) };
        const producer = new SrikandiBusinessProducer(readyConfig(), outbox as any);

        await producer.suratMasukCreated({}, {
            ...record,
            tanggalSurat: new Date('2026-08-28T15:30:00.000Z'),
        });

        expect(outbox.enqueueWithExecutor).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                payload: expect.objectContaining({
                    record: expect.objectContaining({ tanggalSurat: '2026-08-28' }),
                }),
            }),
        );
    });

    it('fails closed when enabled without a complete producer contract', async () => {
        const outbox = { enqueueWithExecutor: vi.fn() };
        const producer = new SrikandiBusinessProducer(buildSrikandiConfig({
            SRIKANDI_PRODUCER_ENABLED: 'true',
        }), outbox as any);

        await expect(producer.suratKeluarCreated({}, record)).rejects.toMatchObject({
            statusCode: 503,
        });
        expect(outbox.enqueueWithExecutor).not.toHaveBeenCalled();
    });
});
