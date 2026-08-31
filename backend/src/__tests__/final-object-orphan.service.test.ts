import { beforeEach, describe, expect, it, vi } from 'vitest';

const databaseMocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../config/database.js', () => ({
    pool: { query: databaseMocks.query },
}));

import {
    FinalObjectOrphanReconciler,
    GcsFinalObjectOrphanDeleter,
    PostgresFinalObjectOrphanRepository,
    type ClaimedFinalObjectOrphan,
    type FinalObjectOrphanDeleter,
    type FinalObjectOrphanRepository,
    type FinalObjectOrphanTerminalStatus,
} from '../services/final-object-orphan.service.js';

const NOW = new Date('2026-08-31T00:00:00.000Z');

function orphan(overrides: Partial<ClaimedFinalObjectOrphan> = {}): ClaimedFinalObjectOrphan {
    return {
        id: '10000000-0000-4000-8000-000000000001',
        attachmentId: '00000000-0000-4000-8000-000000000001',
        candidateKind: 'scanner_promotion',
        cleanupToken: null,
        finalLocator: 'gs://simsa-final/released/00000000-0000-4000-8000-000000000001/1-record.pdf',
        finalObjectGeneration: '1735689600999999',
        sourceLocator: 'gs://simsa-upload/surat-masuk/record.pdf',
        sourceObjectGeneration: '1735689600123456',
        attempts: 1,
        ...overrides,
    };
}

class FakeRepository implements FinalObjectOrphanRepository {
    readonly completions: Array<{
        job: ClaimedFinalObjectOrphan;
        status: FinalObjectOrphanTerminalStatus;
        error?: string;
        retryAt?: Date;
    }> = [];
    referenced = false;
    completeAccepted = true;
    readonly claimArguments: Array<{
        staleBefore: Date;
        maxAttempts: number;
        eligibleCreatedBefore: Date;
    }> = [];

    constructor(readonly jobs: ClaimedFinalObjectOrphan[]) {}

    async claimNext(
        staleBefore: Date,
        maxAttempts: number,
        eligibleCreatedBefore: Date,
    ): Promise<ClaimedFinalObjectOrphan | null> {
        this.claimArguments.push({ staleBefore, maxAttempts, eligibleCreatedBefore });
        return this.jobs.shift() || null;
    }

    async hasLiveReference(): Promise<boolean> {
        return this.referenced;
    }

    async complete(
        job: ClaimedFinalObjectOrphan,
        status: FinalObjectOrphanTerminalStatus,
        error?: string,
        retryAt?: Date,
    ): Promise<boolean> {
        this.completions.push({ job, status, error, retryAt });
        return this.completeAccepted;
    }
}

function reconciler(
    repository: FakeRepository,
    deletion: Awaited<ReturnType<FinalObjectOrphanDeleter['deleteCandidate']>> | Error,
    overrides: Partial<ConstructorParameters<typeof FinalObjectOrphanReconciler>[0]> = {},
) {
    const deleteCandidate = vi.fn(async () => {
        if (deletion instanceof Error) throw deletion;
        return deletion;
    });
    return {
        deleteCandidate,
        worker: new FinalObjectOrphanReconciler({
            repository,
            deleter: { deleteCandidate },
            now: () => NOW,
            ...overrides,
        }),
    };
}

describe('final private object orphan reconciliation', () => {
    beforeEach(() => {
        databaseMocks.query.mockReset();
    });

    it('protects a candidate that became referenced before cleanup', async () => {
        const repository = new FakeRepository([orphan()]);
        repository.referenced = true;
        const { worker, deleteCandidate } = reconciler(repository, 'deleted');

        await expect(worker.run()).resolves.toMatchObject({
            inspected: 1,
            referenced: 1,
            deleted: 0,
        });
        expect(deleteCandidate).not.toHaveBeenCalled();
        expect(repository.completions[0]).toMatchObject({ status: 'referenced' });
    });

    it.each([
        ['deleted', 'deleted', { deleted: 1 }],
        ['not_found', 'not_found', { missing: 1 }],
        ['identity_mismatch', 'identity_mismatch', { identityMismatch: 1 }],
    ] as const)('records a storage %s outcome durably', async (_label, deletion, expected) => {
        const repository = new FakeRepository([orphan()]);
        const { worker } = reconciler(repository, deletion);

        await expect(worker.run()).resolves.toMatchObject({ inspected: 1, ...expected });
        expect(repository.completions[0]).toMatchObject({ status: deletion });
    });

    it('backs off a transient storage failure without losing the claim', async () => {
        const repository = new FakeRepository([orphan({ attempts: 2 })]);
        const { worker } = reconciler(repository, new Error('GCS temporarily unavailable'), {
            retryBaseMs: 2_000,
            retryMaxMs: 10_000,
        });

        await expect(worker.run()).resolves.toMatchObject({ retried: 1, failed: 0 });
        expect(repository.completions[0]).toMatchObject({
            status: 'retry',
            error: 'GCS temporarily unavailable',
            retryAt: new Date('2026-08-31T00:00:04.000Z'),
        });
    });

    it('makes an exhausted cleanup failure terminal for operator intervention', async () => {
        const repository = new FakeRepository([orphan({ attempts: 10 })]);
        const { worker } = reconciler(repository, new Error('retention policy denied deletion'), {
            maxAttempts: 10,
        });

        await expect(worker.run()).resolves.toMatchObject({ retried: 0, failed: 1 });
        expect(repository.completions[0]).toMatchObject({
            status: 'failed',
            error: 'retention policy denied deletion',
        });
    });

    it('finishes an idempotent stale recovery after the max-attempt claim crashed', async () => {
        const repository = new FakeRepository([orphan({ attempts: 11 })]);
        const { worker } = reconciler(repository, 'not_found', { maxAttempts: 10 });

        await expect(worker.run()).resolves.toMatchObject({
            inspected: 1,
            missing: 1,
            failed: 0,
            retried: 0,
        });
        expect(repository.completions[0]).toMatchObject({
            status: 'not_found',
            job: expect.objectContaining({ attempts: 11 }),
        });
    });

    it('reclaims a stale deleting row outside the ordinary attempt-budget predicate', async () => {
        databaseMocks.query.mockResolvedValueOnce({
            rows: [{
                id: orphan().id,
                attachment_id: orphan().attachmentId,
                candidate_kind: orphan().candidateKind,
                cleanup_token: orphan().cleanupToken,
                final_locator: orphan().finalLocator,
                final_object_generation: orphan().finalObjectGeneration,
                source_locator: orphan().sourceLocator,
                source_object_generation: orphan().sourceObjectGeneration,
                attempts: 11,
            }],
        });
        const repository = new PostgresFinalObjectOrphanRepository();

        await expect(repository.claimNext(
            new Date('2026-08-30T23:45:00.000Z'),
            10,
            new Date('2026-08-01T00:00:00.000Z'),
        )).resolves.toMatchObject({ attempts: 11 });

        const [query, parameters] = databaseMocks.query.mock.calls[0] as [string, unknown[]];
        expect(query).toContain("status IN ('reserved', 'pending', 'retry', 'reference_check')\n                      AND attempts < $2");
        expect(query).toContain("OR (status = 'deleting' AND cleanup_started_at <= $1)");
        expect(query.indexOf('AND attempts < $2')).toBeLessThan(query.indexOf("OR (status = 'deleting'"));
        expect(parameters).toEqual([
            new Date('2026-08-30T23:45:00.000Z'),
            10,
            new Date('2026-08-01T00:00:00.000Z'),
        ]);
    });

    it('reports a lost conditional completion without claiming success', async () => {
        const repository = new FakeRepository([orphan()]);
        repository.completeAccepted = false;
        const { worker } = reconciler(repository, 'deleted');

        await expect(worker.run()).resolves.toMatchObject({
            inspected: 1,
            deleted: 0,
            staleClaims: 1,
        });
    });

    it('rejects unbounded cleanup batches', async () => {
        const { worker } = reconciler(new FakeRepository([]), 'deleted');
        await expect(worker.run(0)).rejects.toThrow(/between 1 and 1000/);
        await expect(worker.run(1001)).rejects.toThrow(/between 1 and 1000/);
    });

    it('defends the 30-day retention plus margin even if a queue date is malformed', async () => {
        const repository = new FakeRepository([]);
        const minimumObjectAgeMs = (30 * 24 * 60 * 60_000) + (60 * 60_000);
        const { worker } = reconciler(repository, 'deleted', { minimumObjectAgeMs });

        await expect(worker.run()).resolves.toMatchObject({ inspected: 0 });
        expect(repository.claimArguments[0]).toMatchObject({
            eligibleCreatedBefore: new Date(NOW.getTime() - minimumObjectAgeMs),
        });
    });

    it('routes an API reservation to the isolated metadata-fenced deletion path', async () => {
        const deleteApiFinalOrphan = vi.fn().mockResolvedValue('deleted');
        const deletePromotedOrphan = vi.fn();
        const deleter = new GcsFinalObjectOrphanDeleter({
            deleteApiFinalOrphan,
            deletePromotedOrphan,
        } as any);
        const job = orphan({
            candidateKind: 'api_final',
            cleanupToken: '20000000-0000-4000-8000-000000000001',
            finalLocator: 'gs://simsa-final/autentikasi/queued.pdf',
            finalObjectGeneration: null,
            sourceLocator: null,
            sourceObjectGeneration: null,
        });

        await expect(deleter.deleteCandidate(job)).resolves.toBe('deleted');
        expect(deleteApiFinalOrphan).toHaveBeenCalledWith({
            locator: job.finalLocator,
            generation: null,
            ownerId: job.attachmentId,
            cleanupToken: job.cleanupToken,
        });
        expect(deletePromotedOrphan).not.toHaveBeenCalled();
    });
});
