import { randomUUID } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import {
    bulkUploadBatches,
    bulkUploadItems,
    ocrCapacityControl,
    ocrProcessingLeases,
} from '../db/schema/index.js';

export interface OcrCapacityLease {
    itemId: string;
    token: string;
    acquiredAt: Date;
    leaseExpiresAt: Date;
}

export type OcrCapacityAcquireResult =
    | { acquired: true; lease: OcrCapacityLease }
    | { acquired: false; retryAfterSeconds: number };

export interface OcrCapacityCoordinator {
    acquire(itemId: string): Promise<OcrCapacityAcquireResult>;
    renew(lease: Pick<OcrCapacityLease, 'itemId' | 'token'>): Promise<OcrCapacityLease | null>;
    release(lease: Pick<OcrCapacityLease, 'itemId' | 'token'>): Promise<boolean>;
}

/**
 * Cross-instance semaphore for the CPU-intensive Tesseract path.
 *
 * Only the short capacity decision is transactional. The caller receives a
 * durable, expiring token and must release it after OCR, outside this method's
 * transaction. This deliberately avoids holding a database connection or row
 * lock while Tesseract is running.
 */
export class OcrCapacityService {
    async acquire(itemId: string): Promise<OcrCapacityAcquireResult> {
        const token = randomUUID();

        return db.transaction(async (tx) => {
            const [control] = await tx
                .select()
                .from(ocrCapacityControl)
                .where(eq(ocrCapacityControl.singletonId, 1))
                .for('update')
                .limit(1);

            if (!control) {
                throw new Error('Konfigurasi kapasitas OCR belum dimigrasikan');
            }

            // Database time is authoritative across hosts. Reclaim abandoned
            // work before counting capacity; no application clock is involved.
            await tx.delete(ocrProcessingLeases)
                .where(sql`${ocrProcessingLeases.leaseExpiresAt} <= now()`);

            const [existing] = await tx
                .select({ token: ocrProcessingLeases.token })
                .from(ocrProcessingLeases)
                .where(and(
                    eq(ocrProcessingLeases.itemId, itemId),
                    gt(ocrProcessingLeases.leaseExpiresAt, sql`now()`),
                ))
                .limit(1);

            const [capacity] = await tx
                .select({ count: sql<number>`count(*)::int` })
                .from(ocrProcessingLeases)
                .where(gt(ocrProcessingLeases.leaseExpiresAt, sql`now()`));

            if (existing || (capacity?.count ?? 0) >= control.maxConcurrency) {
                return {
                    acquired: false as const,
                    retryAfterSeconds: control.retryAfterSeconds,
                };
            }

            const [lease] = await tx.insert(ocrProcessingLeases)
                .values({
                    token,
                    itemId,
                    acquiredAt: sql`now()`,
                    leaseExpiresAt: sql`now() + (${control.leaseDurationSeconds} * interval '1 second')`,
                })
                .returning();

            if (!lease) throw new Error('Lease kapasitas OCR gagal dibuat');

            return {
                acquired: true as const,
                lease: {
                    itemId: lease.itemId,
                    token: lease.token,
                    acquiredAt: lease.acquiredAt,
                    leaseExpiresAt: lease.leaseExpiresAt,
                },
            };
        });
    }

    /**
     * Extend only the still-live lease identified by the exact item/token pair.
     * Database time and the singleton duration remain authoritative, so replica
     * clock skew cannot shorten or lengthen global capacity ownership.
     */
    async renew(
        lease: Pick<OcrCapacityLease, 'itemId' | 'token'>,
    ): Promise<OcrCapacityLease | null> {
        const [renewed] = await db.update(ocrProcessingLeases)
            .set({
                leaseExpiresAt: sql`now() + ((
                    SELECT ${ocrCapacityControl.leaseDurationSeconds}
                    FROM ${ocrCapacityControl}
                    WHERE ${ocrCapacityControl.singletonId} = 1
                ) * interval '1 second')`,
            })
            .where(and(
                eq(ocrProcessingLeases.itemId, lease.itemId),
                eq(ocrProcessingLeases.token, lease.token),
                gt(ocrProcessingLeases.leaseExpiresAt, sql`now()`),
                sql`exists (
                    select 1
                    from ${bulkUploadItems} item
                    inner join ${bulkUploadBatches} batch
                        on batch.id = item.batch_id
                    where item.id = ${ocrProcessingLeases.itemId}
                      and item.status = 'processing'
                      and batch.status in ('pending', 'processing', 'completed', 'partial')
                      and batch.expires_at > now()
                )`,
            ))
            .returning();

        if (!renewed) return null;
        return {
            itemId: renewed.itemId,
            token: renewed.token,
            acquiredAt: renewed.acquiredAt,
            leaseExpiresAt: renewed.leaseExpiresAt,
        };
    }

    /** Release succeeds only for the exact item/token pair returned by acquire. */
    async release(lease: Pick<OcrCapacityLease, 'itemId' | 'token'>): Promise<boolean> {
        const released = await db.delete(ocrProcessingLeases)
            .where(and(
                eq(ocrProcessingLeases.itemId, lease.itemId),
                eq(ocrProcessingLeases.token, lease.token),
            ))
            .returning({ token: ocrProcessingLeases.token });
        return released.length === 1;
    }
}

export const ocrCapacityService = new OcrCapacityService();
