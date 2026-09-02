import { createHash, randomUUID } from 'node:crypto';
import {
    and,
    desc,
    eq,
    inArray,
    isNull,
    lte,
    or,
    sql,
    type SQL,
} from 'drizzle-orm';
import { db, type Database } from '../config/database.js';
import { srikandiConfig, type SrikandiConfig } from '../config/srikandi.js';
import {
    srikandiOutbox,
    srikandiOutboxAudit,
    type SrikandiOutbox,
    type SrikandiOutboxStatus,
} from '../db/schema/index.js';
import type { RecordUnitScope } from '../utils/record-unit-scope.js';
import { AppError, ConflictError, ValidationError } from '../utils/errors.js';
import {
    SrikandiDeliveryError,
    srikandiHttpAdapter,
    type SrikandiHttpAdapterLike,
} from './srikandi-http.adapter.js';

const MAX_PAYLOAD_BYTES = 256 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/;
const SAFE_EVENT_PATTERN = /^[a-z][a-z0-9_.-]*$/;

export interface EnqueueSrikandiMessage {
    unitKerjaId: string;
    idempotencyKey: string;
    eventType: string;
    sourceEntityType: string;
    sourceEntityId: string;
    payload: Record<string, unknown>;
    createdBy?: string;
}

export interface SrikandiMessageHashInput extends Omit<EnqueueSrikandiMessage, 'createdBy'> {
    contractVersion: string;
}

export interface SrikandiOutboxListFilters {
    unitScope: RecordUnitScope;
    status?: SrikandiOutboxStatus;
    page?: number;
    limit?: number;
}

export interface SrikandiDispatchResult {
    item: SrikandiOutbox;
    outcome: 'succeeded' | 'retry_scheduled' | 'dead_letter';
}

export class SrikandiIntegrationUnavailableError extends AppError {
    constructor(message = 'Integrasi SRIKANDI dinonaktifkan atau konfigurasi resmi belum lengkap') {
        super(message, 503);
    }
}

function canonicalize(value: unknown, seen: Set<object>): string {
    if (value === null) return 'null';
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new ValidationError('Payload SRIKANDI memuat angka tidak valid');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        if (seen.has(value)) throw new ValidationError('Payload SRIKANDI tidak boleh memuat referensi siklik');
        seen.add(value);
        const result = `[${value.map(item => canonicalize(item, seen)).join(',')}]`;
        seen.delete(value);
        return result;
    }
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const prototype = Object.getPrototypeOf(record);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new ValidationError('Payload SRIKANDI harus berupa data JSON biasa');
        }
        if (seen.has(record)) throw new ValidationError('Payload SRIKANDI tidak boleh memuat referensi siklik');
        seen.add(record);
        const entries = Object.keys(record)
            .sort()
            .filter(key => record[key] !== undefined)
            .map(key => `${JSON.stringify(key)}:${canonicalize(record[key], seen)}`);
        seen.delete(record);
        return `{${entries.join(',')}}`;
    }
    throw new ValidationError('Payload SRIKANDI hanya boleh memuat nilai JSON');
}

export function computeSrikandiMessageHash(message: SrikandiMessageHashInput): string {
    const canonical = canonicalize({
        contractVersion: message.contractVersion,
        eventType: message.eventType,
        sourceEntityType: message.sourceEntityType,
        sourceEntityId: message.sourceEntityId,
        payload: message.payload,
    }, new Set());
    return createHash('sha256').update(canonical).digest('hex');
}

export function calculateSrikandiBackoffMs(
    attemptCount: number,
    baseSeconds: number,
    maxSeconds: number,
): number {
    const exponent = Math.max(0, attemptCount - 1);
    return Math.min(baseSeconds * (2 ** exponent), maxSeconds) * 1000;
}

export function planSrikandiFailure(
    retryable: boolean,
    attemptCount: number,
    maxAttempts: number,
    now: Date,
    baseSeconds: number,
    maxSeconds: number,
): { status: 'retry_scheduled' | 'dead_letter'; nextAttemptAt: Date | null } {
    const retry = retryable && attemptCount < maxAttempts;
    return {
        status: retry ? 'retry_scheduled' : 'dead_letter',
        nextAttemptAt: retry
            ? new Date(now.getTime() + calculateSrikandiBackoffMs(
                attemptCount,
                baseSeconds,
                maxSeconds,
            ))
            : null,
    };
}

function scopedConditions(unitScope: RecordUnitScope): SQL[] {
    return unitScope === null ? [] : [eq(srikandiOutbox.unitKerjaId, unitScope)];
}

function validateEnqueueInput(input: EnqueueSrikandiMessage): void {
    if (!input.unitKerjaId.trim() || input.unitKerjaId.length > 50) {
        throw new ValidationError('unitKerjaId SRIKANDI tidak valid');
    }
    if (
        input.idempotencyKey.length < 8
        || input.idempotencyKey.length > 128
        || !SAFE_KEY_PATTERN.test(input.idempotencyKey)
    ) {
        throw new ValidationError('Idempotency key SRIKANDI tidak valid');
    }
    if (
        input.eventType.length < 3
        || input.eventType.length > 100
        || !SAFE_EVENT_PATTERN.test(input.eventType)
    ) {
        throw new ValidationError('Event type SRIKANDI tidak valid');
    }
    if (
        input.sourceEntityType.length < 2
        || input.sourceEntityType.length > 50
        || !SAFE_EVENT_PATTERN.test(input.sourceEntityType)
    ) {
        throw new ValidationError('Source entity type SRIKANDI tidak valid');
    }
    if (!UUID_PATTERN.test(input.sourceEntityId)) {
        throw new ValidationError('Source entity ID SRIKANDI harus berupa UUID');
    }

    const encoded = canonicalize(input.payload, new Set());
    if (Buffer.byteLength(encoded, 'utf8') > MAX_PAYLOAD_BYTES) {
        throw new ValidationError('Payload SRIKANDI melebihi 256 KiB');
    }
}

export class SrikandiService {
    constructor(
        private readonly database: Database = db,
        private readonly adapter: SrikandiHttpAdapterLike = srikandiHttpAdapter,
        private readonly config: SrikandiConfig = srikandiConfig,
    ) {}

    /**
     * Internal producer API. Idempotency is scoped to a unit and a replay with
     * different content is rejected instead of silently replacing evidence.
     */
    async enqueue(input: EnqueueSrikandiMessage): Promise<{ item: SrikandiOutbox; created: boolean }> {
        // Reject malformed/unconfigured messages before opening a transaction;
        // enqueueWithExecutor repeats this guard for transactional producers.
        validateEnqueueInput(input);
        const contractVersion = this.config.contractVersion.trim();
        if (!contractVersion || contractVersion.length > 100 || /\r|\n/.test(contractVersion)) {
            throw new SrikandiIntegrationUnavailableError(
                'Versi kontrak resmi SRIKANDI wajib dikonfigurasi sebelum membuat outbox',
            );
        }
        return this.database.transaction((tx) => this.enqueueWithExecutor(tx, input));
    }

    /**
     * Enqueue using an existing business transaction. This is intentionally
     * public only for internal producers so the business row, outbox evidence,
     * and its append-only audit either commit together or all roll back.
     */
    async enqueueWithExecutor(
        executor: any,
        input: EnqueueSrikandiMessage,
    ): Promise<{ item: SrikandiOutbox; created: boolean }> {
        validateEnqueueInput(input);
        const contractVersion = this.config.contractVersion.trim();
        if (!contractVersion || contractVersion.length > 100 || /\r|\n/.test(contractVersion)) {
            throw new SrikandiIntegrationUnavailableError(
                'Versi kontrak resmi SRIKANDI wajib dikonfigurasi sebelum membuat outbox',
            );
        }
        const messageHash = computeSrikandiMessageHash({ ...input, contractVersion });
        const now = new Date();

        const [created] = await executor
                .insert(srikandiOutbox)
                .values({
                    unitKerjaId: input.unitKerjaId.trim(),
                    idempotencyKey: input.idempotencyKey,
                    contractVersion,
                    messageHash,
                    eventType: input.eventType,
                    sourceEntityType: input.sourceEntityType,
                    sourceEntityId: input.sourceEntityId,
                    payload: input.payload,
                    maxAttempts: this.config.maxAttempts,
                    nextAttemptAt: now,
                    createdBy: input.createdBy || null,
                    createdAt: now,
                    updatedAt: now,
                })
                .onConflictDoNothing({
                    target: [srikandiOutbox.unitKerjaId, srikandiOutbox.idempotencyKey],
                })
                .returning();

        if (created) {
            // This append-only row is part of the same transaction. If audit
            // insertion fails, no unaudited outbox record is committed.
            await executor.insert(srikandiOutboxAudit).values({
                outboxId: created.id,
                unitKerjaId: created.unitKerjaId,
                event: 'enqueued',
                actorUserId: input.createdBy || null,
                details: {
                    messageHash,
                    contractVersion: created.contractVersion,
                    eventType: created.eventType,
                    sourceEntityType: created.sourceEntityType,
                    sourceEntityId: created.sourceEntityId,
                },
            });
            return { item: created, created: true };
        }

        const [existing] = await executor
            .select()
            .from(srikandiOutbox)
            .where(and(
                eq(srikandiOutbox.unitKerjaId, input.unitKerjaId.trim()),
                eq(srikandiOutbox.idempotencyKey, input.idempotencyKey),
            ))
            .limit(1);

        if (!existing) {
            throw new ConflictError('Idempotency key sedang diproses; coba lagi');
        }
        if (existing.messageHash !== messageHash) {
            throw new ConflictError('Idempotency key telah digunakan untuk pesan SRIKANDI yang berbeda');
        }
        return { item: existing, created: false };
    }

    async list(filters: SrikandiOutboxListFilters) {
        const page = Math.max(1, filters.page || 1);
        const limit = Math.min(100, Math.max(1, filters.limit || 20));
        const conditions = scopedConditions(filters.unitScope);
        if (filters.status) conditions.push(eq(srikandiOutbox.status, filters.status));
        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const [{ count }] = await this.database
            .select({ count: sql<number>`count(*)::int` })
            .from(srikandiOutbox)
            .where(where);
        const data = await this.database
            .select()
            .from(srikandiOutbox)
            .where(where)
            .orderBy(desc(srikandiOutbox.createdAt))
            .limit(limit)
            .offset((page - 1) * limit);

        return {
            data,
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit),
            },
        };
    }

    async findById(id: string, unitScope: RecordUnitScope): Promise<SrikandiOutbox | null> {
        const [item] = await this.database
            .select()
            .from(srikandiOutbox)
            .where(and(eq(srikandiOutbox.id, id), ...scopedConditions(unitScope)))
            .limit(1);
        return item || null;
    }

    async getDetail(id: string, unitScope: RecordUnitScope) {
        const item = await this.findById(id, unitScope);
        if (!item) return null;

        const audit = await this.database
            .select()
            .from(srikandiOutboxAudit)
            .where(and(
                eq(srikandiOutboxAudit.outboxId, item.id),
                eq(srikandiOutboxAudit.unitKerjaId, item.unitKerjaId),
            ))
            .orderBy(desc(srikandiOutboxAudit.createdAt));
        return { item, audit };
    }

    private async claim(id: string, unitScope: RecordUnitScope, actorUserId?: string) {
        const now = new Date();
        const lockToken = randomUUID();
        const leaseExpiresAt = new Date(now.getTime() + this.config.timeoutMs + 30_000);
        const eligible = or(
            and(
                inArray(srikandiOutbox.status, ['pending', 'retry_scheduled']),
                or(isNull(srikandiOutbox.nextAttemptAt), lte(srikandiOutbox.nextAttemptAt, now)),
            ),
            and(
                eq(srikandiOutbox.status, 'processing'),
                or(isNull(srikandiOutbox.leaseExpiresAt), lte(srikandiOutbox.leaseExpiresAt, now)),
            ),
        )!;

        return this.database.transaction(async (tx) => {
            const [claimed] = await tx
                .update(srikandiOutbox)
                .set({
                    status: 'processing',
                    attemptCount: sql`${srikandiOutbox.attemptCount} + 1`,
                    lastAttemptAt: now,
                    lockToken,
                    leaseExpiresAt,
                    updatedAt: now,
                })
                .where(and(
                    eq(srikandiOutbox.id, id),
                    ...scopedConditions(unitScope),
                    eligible,
                ))
                .returning();

            if (!claimed) return null;

            await tx.insert(srikandiOutboxAudit).values({
                outboxId: claimed.id,
                unitKerjaId: claimed.unitKerjaId,
                event: 'claimed',
                actorUserId: actorUserId || null,
                details: {
                    attemptCount: claimed.attemptCount,
                    leaseExpiresAt: leaseExpiresAt.toISOString(),
                },
            });

            return claimed;
        });
    }

    private async finalizeSuccess(
        claimed: SrikandiOutbox,
        acknowledgment: Awaited<ReturnType<SrikandiHttpAdapterLike['send']>>,
        actorUserId?: string,
    ): Promise<SrikandiOutbox> {
        const now = new Date();
        return this.database.transaction(async (tx) => {
            const [updated] = await tx
                .update(srikandiOutbox)
                .set({
                    status: 'succeeded',
                    remoteId: acknowledgment.remoteId,
                    lastHttpStatus: acknowledgment.httpStatus,
                    responsePayload: acknowledgment.responsePayload,
                    officialResponseAt: acknowledgment.receivedAt,
                    succeededAt: now,
                    nextAttemptAt: null,
                    lockToken: null,
                    leaseExpiresAt: null,
                    lastError: null,
                    updatedAt: now,
                })
                .where(and(
                    eq(srikandiOutbox.id, claimed.id),
                    eq(srikandiOutbox.status, 'processing'),
                    eq(srikandiOutbox.lockToken, claimed.lockToken!),
                ))
                .returning();

            if (!updated) throw new ConflictError('Klaim outbox SRIKANDI tidak lagi berlaku');

            await tx.insert(srikandiOutboxAudit).values({
                outboxId: updated.id,
                unitKerjaId: updated.unitKerjaId,
                event: 'attempt_succeeded',
                actorUserId: actorUserId || null,
                details: {
                    attemptCount: updated.attemptCount,
                    httpStatus: acknowledgment.httpStatus,
                    remoteId: acknowledgment.remoteId,
                    officialResponseAt: acknowledgment.receivedAt.toISOString(),
                },
            });
            return updated;
        });
    }

    private async finalizeFailure(
        claimed: SrikandiOutbox,
        error: SrikandiDeliveryError,
        actorUserId?: string,
    ): Promise<SrikandiDispatchResult> {
        const now = new Date();
        const { status, nextAttemptAt } = planSrikandiFailure(
            error.retryable,
            claimed.attemptCount,
            claimed.maxAttempts,
            now,
            this.config.backoffBaseSeconds,
            this.config.backoffMaxSeconds,
        );
        const retry = status === 'retry_scheduled';

        const item = await this.database.transaction(async (tx) => {
            const [updated] = await tx
                .update(srikandiOutbox)
                .set({
                    status,
                    nextAttemptAt,
                    deadLetteredAt: retry ? null : now,
                    lastError: error.message.slice(0, 4_000),
                    lastHttpStatus: error.httpStatus || null,
                    responsePayload: error.responsePayload || null,
                    lockToken: null,
                    leaseExpiresAt: null,
                    updatedAt: now,
                })
                .where(and(
                    eq(srikandiOutbox.id, claimed.id),
                    eq(srikandiOutbox.status, 'processing'),
                    eq(srikandiOutbox.lockToken, claimed.lockToken!),
                ))
                .returning();

            if (!updated) throw new ConflictError('Klaim outbox SRIKANDI tidak lagi berlaku');

            await tx.insert(srikandiOutboxAudit).values({
                outboxId: updated.id,
                unitKerjaId: updated.unitKerjaId,
                event: retry ? 'retry_scheduled' : 'dead_lettered',
                actorUserId: actorUserId || null,
                details: {
                    attemptCount: updated.attemptCount,
                    maxAttempts: updated.maxAttempts,
                    retryable: error.retryable,
                    httpStatus: error.httpStatus || null,
                    nextAttemptAt: nextAttemptAt?.toISOString() || null,
                    error: error.message.slice(0, 1_000),
                },
            });
            return updated;
        });

        return { item, outcome: retry ? 'retry_scheduled' : 'dead_letter' };
    }

    async dispatchOne(
        id: string,
        unitScope: RecordUnitScope,
        actorUserId?: string,
    ): Promise<SrikandiDispatchResult | null> {
        if (!this.config.enabled || !this.config.ready) {
            throw new SrikandiIntegrationUnavailableError();
        }

        const claimed = await this.claim(id, unitScope, actorUserId);
        if (!claimed) {
            const existing = await this.findById(id, unitScope);
            if (!existing) return null;
            throw new ConflictError('Outbox SRIKANDI belum jatuh tempo atau sedang diproses');
        }

        let acknowledgment: Awaited<ReturnType<SrikandiHttpAdapterLike['send']>>;
        try {
            acknowledgment = await this.adapter.send({
                id: claimed.id,
                idempotencyKey: claimed.idempotencyKey,
                contractVersion: claimed.contractVersion,
                eventType: claimed.eventType,
                unitKerjaId: claimed.unitKerjaId,
                sourceEntityType: claimed.sourceEntityType,
                sourceEntityId: claimed.sourceEntityId,
                payload: claimed.payload,
                createdAt: claimed.createdAt,
            });
        } catch (error) {
            const deliveryError = error instanceof SrikandiDeliveryError
                ? error
                : new SrikandiDeliveryError('Pengiriman SRIKANDI gagal tanpa respons resmi', true);
            return this.finalizeFailure(claimed, deliveryError, actorUserId);
        }

        // `send` can only resolve after the official acknowledgment and remote
        // ID have been validated; HTTP 2xx alone never reaches here. Deliberately
        // keep DB/audit finalization outside the delivery catch: if that
        // transaction fails, the row remains processing until lease expiry and a
        // later retry uses the same idempotency key. We never downgrade an
        // acknowledged remote action based on a local audit failure.
        const item = await this.finalizeSuccess(claimed, acknowledgment, actorUserId);
        return { item, outcome: 'succeeded' };
    }

    async manualRetry(
        id: string,
        unitScope: RecordUnitScope,
        actorUserId: string,
        reason: string,
    ): Promise<SrikandiOutbox | null> {
        const normalizedReason = reason.trim();
        if (normalizedReason.length < 10 || normalizedReason.length > 1_000) {
            throw new ValidationError('Alasan retry harus berisi 10 sampai 1000 karakter');
        }
        const now = new Date();

        return this.database.transaction(async (tx) => {
            const [updated] = await tx
                .update(srikandiOutbox)
                .set({
                    status: 'pending',
                    attemptCount: 0,
                    maxAttempts: this.config.maxAttempts,
                    nextAttemptAt: now,
                    lockToken: null,
                    leaseExpiresAt: null,
                    deadLetteredAt: null,
                    updatedAt: now,
                })
                .where(and(
                    eq(srikandiOutbox.id, id),
                    ...scopedConditions(unitScope),
                    inArray(srikandiOutbox.status, ['dead_letter', 'retry_scheduled']),
                ))
                .returning();

            if (!updated) return null;

            await tx.insert(srikandiOutboxAudit).values({
                outboxId: updated.id,
                unitKerjaId: updated.unitKerjaId,
                event: 'manual_retry',
                actorUserId,
                details: {
                    reason: normalizedReason,
                    previousError: updated.lastError?.slice(0, 1_000) || null,
                    resetMaxAttempts: updated.maxAttempts,
                },
            });
            return updated;
        });
    }

    async dispatchDue(
        unitScope: RecordUnitScope,
        limit: number,
        actorUserId?: string,
    ): Promise<SrikandiDispatchResult[]> {
        if (!this.config.enabled || !this.config.ready) {
            throw new SrikandiIntegrationUnavailableError();
        }

        const now = new Date();
        const boundedLimit = Math.min(50, Math.max(1, limit));
        const due = or(
            and(
                inArray(srikandiOutbox.status, ['pending', 'retry_scheduled']),
                or(isNull(srikandiOutbox.nextAttemptAt), lte(srikandiOutbox.nextAttemptAt, now)),
            ),
            and(
                eq(srikandiOutbox.status, 'processing'),
                or(isNull(srikandiOutbox.leaseExpiresAt), lte(srikandiOutbox.leaseExpiresAt, now)),
            ),
        )!;
        const rows = await this.database
            .select({ id: srikandiOutbox.id })
            .from(srikandiOutbox)
            .where(and(...scopedConditions(unitScope), due))
            .orderBy(srikandiOutbox.nextAttemptAt)
            .limit(boundedLimit);

        const results: SrikandiDispatchResult[] = [];
        for (const row of rows) {
            try {
                const result = await this.dispatchOne(row.id, unitScope, actorUserId);
                if (result) results.push(result);
            } catch (error) {
                // A concurrent worker may claim the same selected candidate. Its
                // conditional claim is authoritative, so this worker skips it.
                if (!(error instanceof ConflictError)) throw error;
            }
        }
        return results;
    }
}

export const srikandiService = new SrikandiService();
