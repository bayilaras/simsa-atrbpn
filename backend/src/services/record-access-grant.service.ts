import { and, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { recordAccessGrants, users } from '../db/schema';
import {
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationError,
} from '../utils/errors';
import type { RequestRecordAccessInput } from '../validators/record-access-grant.schemas';
import {
    normalizeSecurityClassification,
    recordAccessService,
    requiresExplicitAccessGrant,
    isAllowedForRecordUnit,
    type RecordEntityType,
    type RecordUser,
} from './record-access.service';

const MAX_GRANT_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_GRANT_DURATION_MS = 15 * 60 * 1000;

function isPostgresUniqueViolation(error: unknown): boolean {
    return Boolean(
        error
        && typeof error === 'object'
        && 'code' in error
        && (error as { code?: unknown }).code === '23505',
    );
}

async function withUniqueConflict<T>(operation: () => Promise<T>, message: string): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        // The partial unique indexes are the final arbiter when two requests
        // race between the pre-check and insert/update.
        if (isPostgresUniqueViolation(error)) throw new ConflictError(message);
        throw error;
    }
}

async function expireStaleGrants(executor: any = db): Promise<void> {
    const now = new Date();
    await executor
        .update(recordAccessGrants)
        .set({ status: 'expired', updatedAt: now })
        .where(and(
            eq(recordAccessGrants.status, 'approved'),
            lte(recordAccessGrants.expiresAt, now),
        ));
}

export function validateGrantExpiry(value: string | Date, now = new Date()): Date {
    const expiresAt = value instanceof Date ? value : new Date(value);
    const duration = expiresAt.getTime() - now.getTime();
    if (!Number.isFinite(expiresAt.getTime())) {
        throw new ValidationError('Waktu kedaluwarsa tidak valid.');
    }
    if (duration < MIN_GRANT_DURATION_MS) {
        throw new ValidationError('Akses harus berlaku setidaknya 15 menit.');
    }
    if (duration > MAX_GRANT_DURATION_MS) {
        throw new ValidationError('Akses tidak boleh diberikan lebih dari 30 hari.');
    }
    return expiresAt;
}

export const recordAccessGrantService = {
    async request(user: RecordUser, input: RequestRecordAccessInput) {
        if (!user.id) throw new ForbiddenError();

        const target = await recordAccessService.inspect(
            user,
            input.entityType,
            input.entityId,
        );
        if (!target.exists || !target.requestable || !target.unitKerjaId) {
            throw new NotFoundError('Rekod');
        }

        const classification = normalizeSecurityClassification(target.classification);
        if (!requiresExplicitAccessGrant(classification)) {
            throw new ConflictError('Rekod ini tidak memerlukan persetujuan akses khusus.');
        }

        return withUniqueConflict(() => db.transaction(async (tx) => {
            await expireStaleGrants(tx);

            const [existing] = await tx
                .select({ id: recordAccessGrants.id, status: recordAccessGrants.status })
                .from(recordAccessGrants)
                .where(and(
                    eq(recordAccessGrants.targetUserId, user.id!),
                    eq(recordAccessGrants.entityType, input.entityType),
                    eq(recordAccessGrants.entityId, input.entityId),
                    inArray(recordAccessGrants.status, ['pending', 'approved']),
                ))
                .limit(1);
            if (existing) {
                throw new ConflictError(
                    existing.status === 'approved'
                        ? 'Akses aktif untuk rekod ini masih berlaku.'
                        : 'Permohonan akses untuk rekod ini masih menunggu keputusan.',
                );
            }

            const [created] = await tx
                .insert(recordAccessGrants)
                .values({
                    requesterId: user.id!,
                    targetUserId: user.id!,
                    entityType: input.entityType,
                    entityId: input.entityId,
                    unitKerjaId: target.unitKerjaId!,
                    requiredClassification: classification,
                    purpose: input.purpose.trim(),
                    accessMode: input.accessMode,
                    status: 'pending',
                })
                .returning();
            if (!created) throw new ConflictError('Permohonan akses gagal dibuat.');
            return created;
        }), 'Permohonan aktif untuk rekod ini sudah ada. Muat ulang data.');
    },

    async listMine(userId: string, filters: { status?: string; page: number; limit: number }) {
        await expireStaleGrants();
        const conditions = [eq(recordAccessGrants.targetUserId, userId)];
        if (filters.status) conditions.push(eq(recordAccessGrants.status, filters.status));
        const where = and(...conditions);
        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(recordAccessGrants)
            .where(where);
        const data = await db
            .select()
            .from(recordAccessGrants)
            .where(where)
            .orderBy(desc(recordAccessGrants.requestedAt))
            .limit(filters.limit)
            .offset((filters.page - 1) * filters.limit);
        return {
            data,
            pagination: {
                page: filters.page,
                limit: filters.limit,
                total: count,
                totalPages: Math.ceil(count / filters.limit),
            },
        };
    },

    async listForReview(filters: { status?: string; page: number; limit: number }) {
        await expireStaleGrants();
        const where = filters.status
            ? eq(recordAccessGrants.status, filters.status)
            : eq(recordAccessGrants.status, 'pending');
        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(recordAccessGrants)
            .where(where);
        const data = await db
            .select({
                id: recordAccessGrants.id,
                requesterId: recordAccessGrants.requesterId,
                requesterEmail: users.email,
                requesterName: users.name,
                entityType: recordAccessGrants.entityType,
                entityId: recordAccessGrants.entityId,
                unitKerjaId: recordAccessGrants.unitKerjaId,
                requiredClassification: recordAccessGrants.requiredClassification,
                purpose: recordAccessGrants.purpose,
                accessMode: recordAccessGrants.accessMode,
                status: recordAccessGrants.status,
                requestedAt: recordAccessGrants.requestedAt,
                decidedBy: recordAccessGrants.decidedBy,
                decidedAt: recordAccessGrants.decidedAt,
                decisionReason: recordAccessGrants.decisionReason,
                expiresAt: recordAccessGrants.expiresAt,
                revokedAt: recordAccessGrants.revokedAt,
            })
            .from(recordAccessGrants)
            .innerJoin(users, eq(recordAccessGrants.targetUserId, users.id))
            .where(where)
            .orderBy(desc(recordAccessGrants.requestedAt))
            .limit(filters.limit)
            .offset((filters.page - 1) * filters.limit);
        return {
            data,
            pagination: {
                page: filters.page,
                limit: filters.limit,
                total: count,
                totalPages: Math.ceil(count / filters.limit),
            },
        };
    },

    async approve(id: string, approverId: string, reason: string, expiry: string | Date) {
        const now = new Date();
        const expiresAt = validateGrantExpiry(expiry, now);
        return withUniqueConflict(() => db.transaction(async (tx) => {
            await expireStaleGrants(tx);
            const [request] = await tx
                .select()
                .from(recordAccessGrants)
                .where(eq(recordAccessGrants.id, id))
                .limit(1)
                .for('update');
            if (!request) throw new NotFoundError('Permohonan akses');
            if (request.status !== 'pending') {
                throw new ConflictError('Permohonan akses sudah diproses.');
            }
            if (request.targetUserId === approverId || request.requesterId === approverId) {
                throw new ForbiddenError('Pemohon tidak boleh menyetujui aksesnya sendiri.');
            }

            const [targetUser] = await tx
                .select({
                    id: users.id,
                    role: users.role,
                    isActive: users.isActive,
                    unitKerjaId: users.unitKerjaId,
                })
                .from(users)
                .where(eq(users.id, request.targetUserId))
                .limit(1)
                .for('update');
            if (
                !targetUser?.isActive ||
                !isAllowedForRecordUnit(targetUser, request.unitKerjaId)
            ) {
                throw new ConflictError('Mandat unit atau status pengguna telah berubah.');
            }

            const [active] = await tx
                .select({ id: recordAccessGrants.id })
                .from(recordAccessGrants)
                .where(and(
                    eq(recordAccessGrants.targetUserId, request.targetUserId),
                    eq(recordAccessGrants.entityType, request.entityType),
                    eq(recordAccessGrants.entityId, request.entityId),
                    eq(recordAccessGrants.status, 'approved'),
                    ne(recordAccessGrants.id, request.id),
                ))
                .limit(1)
                .for('update');
            if (active) throw new ConflictError('Akses aktif untuk rekod ini sudah ada.');

            const [updated] = await tx
                .update(recordAccessGrants)
                .set({
                    status: 'approved',
                    decidedBy: approverId,
                    decidedAt: now,
                    decisionReason: reason.trim(),
                    expiresAt,
                    updatedAt: now,
                })
                .where(and(
                    eq(recordAccessGrants.id, id),
                    eq(recordAccessGrants.status, 'pending'),
                ))
                .returning();
            if (!updated) throw new ConflictError('Status permohonan berubah. Muat ulang data.');
            return updated;
        }), 'Akses aktif untuk rekod ini sudah ada. Muat ulang data.');
    },

    async deny(id: string, approverId: string, reason: string) {
        const now = new Date();
        const [updated] = await db
            .update(recordAccessGrants)
            .set({
                status: 'denied',
                decidedBy: approverId,
                decidedAt: now,
                decisionReason: reason.trim(),
                updatedAt: now,
            })
            .where(and(
                eq(recordAccessGrants.id, id),
                eq(recordAccessGrants.status, 'pending'),
                ne(recordAccessGrants.targetUserId, approverId),
            ))
            .returning();
        if (!updated) throw new ConflictError('Permohonan tidak dapat ditolak atau sudah diproses.');
        return updated;
    },

    async revoke(id: string, actorId: string, reason: string) {
        const now = new Date();
        const [updated] = await db
            .update(recordAccessGrants)
            .set({
                status: 'revoked',
                revokedBy: actorId,
                revokedAt: now,
                revocationReason: reason.trim(),
                updatedAt: now,
            })
            .where(and(
                eq(recordAccessGrants.id, id),
                eq(recordAccessGrants.status, 'approved'),
            ))
            .returning();
        if (!updated) throw new ConflictError('Akses tidak aktif atau sudah dicabut.');
        return updated;
    },
};

export default recordAccessGrantService;
