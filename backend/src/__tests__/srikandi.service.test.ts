import { describe, expect, it, vi } from 'vitest';
import { buildSrikandiConfig } from '../config/srikandi.js';
import {
    computeSrikandiMessageHash,
    SrikandiService,
    type EnqueueSrikandiMessage,
} from '../services/srikandi.service.js';

const enqueueInput: EnqueueSrikandiMessage = {
    unitKerjaId: 'ditjen',
    idempotencyKey: 'arsip:550e8400-e29b-41d4-a716-446655440010:v1',
    eventType: 'archive.registered',
    sourceEntityType: 'arsip',
    sourceEntityId: '550e8400-e29b-41d4-a716-446655440010',
    payload: { nomorBerkas: 'A-1', tahun: 2026 },
    createdBy: '550e8400-e29b-41d4-a716-446655440001',
};

const enqueueConfig = buildSrikandiConfig({
    SRIKANDI_CONTRACT_VERSION: 'official-v1',
});

function outboxRow(overrides: Record<string, unknown> = {}) {
    return {
        id: '550e8400-e29b-41d4-a716-446655440020',
        unitKerjaId: enqueueInput.unitKerjaId,
        idempotencyKey: enqueueInput.idempotencyKey,
        contractVersion: 'official-v1',
        messageHash: computeSrikandiMessageHash({
            ...enqueueInput,
            contractVersion: 'official-v1',
        }),
        eventType: enqueueInput.eventType,
        sourceEntityType: enqueueInput.sourceEntityType,
        sourceEntityId: enqueueInput.sourceEntityId,
        payload: enqueueInput.payload,
        status: 'pending',
        attemptCount: 0,
        maxAttempts: 5,
        nextAttemptAt: new Date(),
        lastAttemptAt: null,
        lockToken: null,
        leaseExpiresAt: null,
        lastError: null,
        lastHttpStatus: null,
        responsePayload: null,
        remoteId: null,
        officialResponseAt: null,
        succeededAt: null,
        deadLetteredAt: null,
        createdBy: enqueueInput.createdBy,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

function fakeEnqueueDatabase(options: {
    created?: any;
    existing?: any;
    auditFailure?: Error;
}) {
    const outboxValues = vi.fn();
    const auditValues = vi.fn(async (value: unknown) => {
        if (options.auditFailure) throw options.auditFailure;
        return value;
    });
    let insertCount = 0;
    const tx = {
        insert: vi.fn(() => {
            insertCount += 1;
            if (insertCount === 1) {
                const returning = vi.fn(async () => options.created ? [options.created] : []);
                return {
                    values: outboxValues.mockImplementation(() => ({
                        onConflictDoNothing: vi.fn(() => ({ returning })),
                    })),
                };
            }
            return { values: auditValues };
        }),
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: vi.fn(async () => options.existing ? [options.existing] : []),
                })),
            })),
        })),
    };
    const database = {
        transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    return { database, tx, outboxValues, auditValues };
}

const unusedAdapter = { send: vi.fn() };

describe('SRIKANDI durable enqueue', () => {
    it('writes the outbox and append-only audit row in one transaction', async () => {
        const row = outboxRow();
        const fake = fakeEnqueueDatabase({ created: row });
        const service = new SrikandiService(
            fake.database as any,
            unusedAdapter,
            enqueueConfig,
        );

        const result = await service.enqueue(enqueueInput);

        expect(result).toEqual({ item: row, created: true });
        expect(fake.database.transaction).toHaveBeenCalledOnce();
        expect(fake.outboxValues).toHaveBeenCalledWith(expect.objectContaining({
            contractVersion: 'official-v1',
        }));
        expect(fake.auditValues).toHaveBeenCalledWith(expect.objectContaining({
            outboxId: row.id,
            unitKerjaId: 'ditjen',
            event: 'enqueued',
            actorUserId: enqueueInput.createdBy,
            details: expect.objectContaining({ contractVersion: 'official-v1' }),
        }));
    });

    it('returns the existing record for an identical idempotent replay', async () => {
        const existing = outboxRow();
        const fake = fakeEnqueueDatabase({ existing });
        const service = new SrikandiService(
            fake.database as any,
            unusedAdapter,
            enqueueConfig,
        );

        await expect(service.enqueue(enqueueInput)).resolves.toEqual({
            item: existing,
            created: false,
        });
        expect(fake.auditValues).not.toHaveBeenCalled();
    });

    it('rejects reuse of an idempotency key with different content', async () => {
        const fake = fakeEnqueueDatabase({
            existing: outboxRow({ messageHash: '0'.repeat(64) }),
        });
        const service = new SrikandiService(
            fake.database as any,
            unusedAdapter,
            enqueueConfig,
        );

        await expect(service.enqueue(enqueueInput)).rejects.toMatchObject({
            statusCode: 409,
        });
    });

    it('rejects an idempotency replay after the configured contract version changes', async () => {
        const existing = outboxRow();
        const fake = fakeEnqueueDatabase({ existing });
        const service = new SrikandiService(
            fake.database as any,
            unusedAdapter,
            buildSrikandiConfig({ SRIKANDI_CONTRACT_VERSION: 'official-v2' }),
        );

        await expect(service.enqueue(enqueueInput)).rejects.toMatchObject({ statusCode: 409 });
    });

    it('fails the transaction when durable audit insertion fails', async () => {
        const fake = fakeEnqueueDatabase({
            created: outboxRow(),
            auditFailure: new Error('audit storage unavailable'),
        });
        const service = new SrikandiService(
            fake.database as any,
            unusedAdapter,
            enqueueConfig,
        );

        await expect(service.enqueue(enqueueInput)).rejects.toThrow('audit storage unavailable');
    });

    it('refuses to enqueue without a contract version snapshot', async () => {
        const fake = fakeEnqueueDatabase({ created: outboxRow() });
        const service = new SrikandiService(
            fake.database as any,
            unusedAdapter,
            buildSrikandiConfig({}),
        );

        await expect(service.enqueue(enqueueInput)).rejects.toMatchObject({ statusCode: 503 });
        expect(fake.database.transaction).not.toHaveBeenCalled();
    });
});
