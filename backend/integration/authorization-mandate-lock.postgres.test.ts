import { afterEach, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import {
    lockAuthorizationMandatesExclusive,
    lockAuthorizationMandatesShared,
} from '../src/utils/authorization-mandate-lock.js';

const testDatabaseUrl = process.env.TEST_POSTGRES_URL;
if (!testDatabaseUrl) {
    throw new Error('TEST_POSTGRES_URL must point to an isolated PostgreSQL test database.');
}

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
};

function deferred<T = void>(): Deferred<T> {
    let resolve!: Deferred<T>['resolve'];
    const promise = new Promise<T>((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
}

function wait(milliseconds: number) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

const clients: Sql[] = [];
function connection() {
    const client = postgres(testDatabaseUrl, {
        max: 1,
        connect_timeout: 5,
        idle_timeout: 1,
    });
    clients.push(client);
    return drizzle(client);
}

afterEach(async () => {
    await Promise.all(clients.splice(0).map(client => client.end({ timeout: 1 })));
});

describe('authorization mandate advisory lock on PostgreSQL', () => {
    it('blocks a mandate mutation until every in-flight approval transaction releases', async () => {
        const approvalDb = connection();
        const mutationDb = connection();
        const approvalHasLock = deferred();
        const releaseApproval = deferred();
        const mutationAttempted = deferred();
        let mutationHasLock = false;

        const approvalTransaction = approvalDb.transaction(async tx => {
            await lockAuthorizationMandatesShared(tx as never);
            approvalHasLock.resolve();
            await releaseApproval.promise;
        });
        await approvalHasLock.promise;

        const mutationTransaction = mutationDb.transaction(async tx => {
            mutationAttempted.resolve();
            await lockAuthorizationMandatesExclusive(tx as never);
            mutationHasLock = true;
        });

        try {
            await mutationAttempted.promise;
            await wait(150);
            expect(mutationHasLock).toBe(false);
        } finally {
            releaseApproval.resolve();
        }

        await Promise.all([approvalTransaction, mutationTransaction]);
        expect(mutationHasLock).toBe(true);
    }, 10_000);

    it('allows approval readers concurrently but blocks them behind a mandate mutation', async () => {
        const firstApprovalDb = connection();
        const secondApprovalDb = connection();
        const mutationDb = connection();
        const releaseFirstApproval = deferred();
        const firstApprovalHasLock = deferred();
        const secondApprovalHasLock = deferred();

        const firstApproval = firstApprovalDb.transaction(async tx => {
            await lockAuthorizationMandatesShared(tx as never);
            firstApprovalHasLock.resolve();
            await releaseFirstApproval.promise;
        });
        await firstApprovalHasLock.promise;

        const secondApproval = secondApprovalDb.transaction(async tx => {
            await lockAuthorizationMandatesShared(tx as never);
            secondApprovalHasLock.resolve();
        });

        await expect(Promise.race([
            secondApprovalHasLock.promise.then(() => 'acquired'),
            wait(1_000).then(() => 'timeout'),
        ])).resolves.toBe('acquired');
        await secondApproval;
        releaseFirstApproval.resolve();
        await firstApproval;

        const mutationHasLock = deferred();
        const releaseMutation = deferred();
        const mutation = mutationDb.transaction(async tx => {
            await lockAuthorizationMandatesExclusive(tx as never);
            mutationHasLock.resolve();
            await releaseMutation.promise;
        });
        await mutationHasLock.promise;

        const blockedApprovalDb = connection();
        let blockedApprovalHasLock = false;
        const blockedApprovalAttempted = deferred();
        const blockedApproval = blockedApprovalDb.transaction(async tx => {
            blockedApprovalAttempted.resolve();
            await lockAuthorizationMandatesShared(tx as never);
            blockedApprovalHasLock = true;
        });

        try {
            await blockedApprovalAttempted.promise;
            await wait(150);
            expect(blockedApprovalHasLock).toBe(false);
        } finally {
            releaseMutation.resolve();
        }

        await Promise.all([mutation, blockedApproval]);
        expect(blockedApprovalHasLock).toBe(true);
    }, 10_000);
});
