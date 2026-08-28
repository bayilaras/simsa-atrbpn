import { randomUUID } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '../config/database.js';
import {
    operationalHeartbeats,
    type OperationalWorker,
} from '../db/schema/operational-heartbeats.js';

type HeartbeatStatus = 'running' | 'degraded' | 'stopped';

export class OperationalHeartbeatService {
    readonly instanceId = randomUUID();
    private registered = false;

    constructor(readonly worker: OperationalWorker) {}

    async record(
        status: HeartbeatStatus,
        details: Record<string, unknown> = {},
    ): Promise<void> {
        const now = new Date();
        if (status === 'stopped') {
            // A superseded replica must never mark a newer live instance as
            // stopped during rolling deployment.
            await db.update(operationalHeartbeats).set({
                status,
                details,
                lastSeenAt: now,
            }).where(and(
                eq(operationalHeartbeats.worker, this.worker),
                eq(operationalHeartbeats.instanceId, this.instanceId),
            ));
            return;
        }

        if (!this.registered) {
            await db.delete(operationalHeartbeats).where(and(
                eq(operationalHeartbeats.worker, this.worker),
                lt(operationalHeartbeats.lastSeenAt, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000)),
            ));
        }

        await db.insert(operationalHeartbeats).values({
            worker: this.worker,
            instanceId: this.instanceId,
            status,
            details,
            startedAt: now,
            lastSeenAt: now,
        }).onConflictDoUpdate({
            target: [operationalHeartbeats.worker, operationalHeartbeats.instanceId],
            set: {
                instanceId: this.instanceId,
                status,
                details,
                lastSeenAt: now,
            },
        });
        this.registered = true;
    }
}
