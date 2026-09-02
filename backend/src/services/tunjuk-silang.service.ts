import { db } from '../config/database.js';
import {
    arsip,
    dosir,
    suratKeluar,
    suratMasuk,
    tunjukSilang,
    type NewTunjukSilang,
} from '../db/schema/index.js';
import { eq, or, and, desc, count, isNull } from 'drizzle-orm';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';

const VALID_ENTITY_TYPES = ['arsip', 'surat_masuk', 'surat_keluar', 'dosir'] as const;
const VALID_RELASI_TYPES = ['balasan', 'tindak_lanjut', 'lampiran', 'referensi', 'revisi', 'duplikat', 'berkaitan'] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type CrossReferenceEntityType = typeof VALID_ENTITY_TYPES[number];
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function requireUuid(value: string | null | undefined, field: string) {
    if (!value || !UUID_PATTERN.test(value)) {
        throw new ValidationError(`${field} harus berupa UUID yang valid.`);
    }
}

function requirePagination(page: number, limit: number) {
    if (!Number.isInteger(page) || page < 1 ||
        !Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new ValidationError('Pagination tunjuk silang tidak valid.');
    }
}

async function lockMutableEndpoint(
    tx: DatabaseTransaction,
    entityType: CrossReferenceEntityType,
    entityId: string,
) {
    if (entityType === 'surat_masuk') {
        const [record] = await tx
            .select({
                id: suratMasuk.id,
                unitKerjaId: suratMasuk.unitKerjaId,
                isDeleted: suratMasuk.isDeleted,
                isArchived: suratMasuk.isArchived,
            })
            .from(suratMasuk)
            .where(eq(suratMasuk.id, entityId))
            .limit(1)
            .for('update');
        if (!record) throw new NotFoundError('Rekod sumber tunjuk silang');
        if (record.isDeleted === true || record.isArchived === true) {
            throw new ConflictError('Rekod sumber tunjuk silang tidak lagi dapat diubah.');
        }
        return { unitKerjaId: record.unitKerjaId };
    }

    if (entityType === 'surat_keluar') {
        const [record] = await tx
            .select({
                id: suratKeluar.id,
                unitKerjaId: suratKeluar.unitKerjaId,
                isDeleted: suratKeluar.isDeleted,
                isArchived: suratKeluar.isArchived,
            })
            .from(suratKeluar)
            .where(eq(suratKeluar.id, entityId))
            .limit(1)
            .for('update');
        if (!record) throw new NotFoundError('Rekod sumber tunjuk silang');
        if (record.isDeleted === true || record.isArchived === true) {
            throw new ConflictError('Rekod sumber tunjuk silang tidak lagi dapat diubah.');
        }
        return { unitKerjaId: record.unitKerjaId };
    }

    if (entityType === 'dosir') {
        const [record] = await tx
            .select({ id: dosir.id, unitKerjaId: dosir.unitKerjaId, status: dosir.status })
            .from(dosir)
            .where(eq(dosir.id, entityId))
            .limit(1)
            .for('update');
        if (!record) throw new NotFoundError('Rekod sumber tunjuk silang');
        if (record.status !== 'open') {
            throw new ConflictError('Dosir yang telah ditutup atau diarsipkan tidak dapat diubah.');
        }
        return { unitKerjaId: record.unitKerjaId };
    }

    const [record] = await tx
        .select({
            id: arsip.id,
            unitKerjaId: arsip.unitKerjaId,
            disposalStatus: arsip.disposalStatus,
            legalHold: arsip.legalHold,
        })
        .from(arsip)
        .where(eq(arsip.id, entityId))
        .limit(1)
        .for('update');
    if (!record) throw new NotFoundError('Rekod sumber tunjuk silang');
    if (record.disposalStatus !== 'active' || record.legalHold !== false) {
        throw new ConflictError('Arsip dalam penyusutan atau legal hold tidak dapat diubah.');
    }
    return { unitKerjaId: record.unitKerjaId };
}

async function lockEndpoints(
    tx: DatabaseTransaction,
    source: { entityType: CrossReferenceEntityType; entityId: string },
    target: { entityType: CrossReferenceEntityType; entityId: string },
) {
    const endpoints = [source, target].sort((left, right) =>
        `${left.entityType}:${left.entityId}`.localeCompare(`${right.entityType}:${right.entityId}`),
    );
    const locked = new Map<string, { unitKerjaId: string }>();
    for (const endpoint of endpoints) {
        const key = `${endpoint.entityType}:${endpoint.entityId}`;
        locked.set(key, await lockMutableEndpoint(tx, endpoint.entityType, endpoint.entityId));
    }
    return {
        source: locked.get(`${source.entityType}:${source.entityId}`)!,
        target: locked.get(`${target.entityType}:${target.entityId}`)!,
    };
}

class TunjukSilangService {

    /**
     * Create a cross-reference between two entities
     */
    async create(data: NewTunjukSilang, auditContext?: CriticalAuditContext) {
        if (!VALID_ENTITY_TYPES.includes(data.sourceType as typeof VALID_ENTITY_TYPES[number])) {
            throw new ValidationError(`Invalid sourceType: ${data.sourceType}`);
        }
        if (!VALID_ENTITY_TYPES.includes(data.targetType as typeof VALID_ENTITY_TYPES[number])) {
            throw new ValidationError(`Invalid targetType: ${data.targetType}`);
        }
        if (!VALID_RELASI_TYPES.includes(data.jenisRelasi as typeof VALID_RELASI_TYPES[number])) {
            throw new ValidationError(`Invalid jenisRelasi: ${data.jenisRelasi}`);
        }
        requireUuid(data.sourceId, 'sourceId');
        requireUuid(data.targetId, 'targetId');
        requireUuid(data.createdBy, 'createdBy');

        if (data.sourceType === data.targetType && data.sourceId === data.targetId) {
            throw new ValidationError('A record cannot reference itself.');
        }
        if (data.keterangan !== undefined && data.keterangan !== null &&
            (typeof data.keterangan !== 'string' || data.keterangan.length > 2000)) {
            throw new ValidationError('Keterangan tunjuk silang tidak valid.');
        }
        if (data.cancelledAt || data.cancelledBy || data.cancellationReason) {
            throw new ValidationError('Tunjuk silang baru tidak boleh berstatus dibatalkan.');
        }

        try {
            return await db.transaction(async (tx) => {
                const endpoints = await lockEndpoints(
                    tx,
                    { entityType: data.sourceType as CrossReferenceEntityType, entityId: data.sourceId },
                    { entityType: data.targetType as CrossReferenceEntityType, entityId: data.targetId },
                );
                if (endpoints.source.unitKerjaId !== endpoints.target.unitKerjaId) {
                    throw new ValidationError('Tunjuk silang hanya dapat dibuat dalam unit kerja yang sama.');
                }

                const [created] = await tx.insert(tunjukSilang).values(data).returning();
                if (!created) throw new ConflictError('Tunjuk silang gagal dibuat.');
                if (auditContext) {
                    await auditLogService.logActionOrThrow({
                        ...auditContext,
                        action: 'create',
                        entityType: 'tunjuk_silang',
                        entityId: created.id,
                        changes: { after: created },
                    }, tx);
                }
                return created;
            });
        } catch (error) {
            if ((error as { code?: string })?.code === '23505') {
                throw new ConflictError('Tunjuk silang aktif tersebut sudah tercatat.');
            }
            throw error;
        }
    }

    /**
     * Find all cross-references for a given entity (both as source and target)
     */
    async findByEntity(
        entityType: string,
        entityId: string,
        pagination: { page?: number; limit?: number } = {},
    ) {
        if (!VALID_ENTITY_TYPES.includes(entityType as typeof VALID_ENTITY_TYPES[number])) {
            throw new ValidationError(`Invalid entityType: ${entityType}`);
        }
        requireUuid(entityId, 'entityId');
        const { page = 1, limit = 100 } = pagination;
        requirePagination(page, limit);
        const offset = (page - 1) * limit;

        const results = await db.select()
            .from(tunjukSilang)
            .where(
                and(
                    or(
                        and(
                            eq(tunjukSilang.sourceType, entityType),
                            eq(tunjukSilang.sourceId, entityId)
                        ),
                        and(
                            eq(tunjukSilang.targetType, entityType),
                            eq(tunjukSilang.targetId, entityId)
                        )
                    ),
                    isNull(tunjukSilang.cancelledAt),
                ),
            )
            .orderBy(desc(tunjukSilang.createdAt))
            .limit(limit)
            .offset(offset);

        // Normalize: for each result, determine direction relative to the queried entity
        return results.map((ref: any) => {
            const isSource = ref.sourceType === entityType && ref.sourceId === entityId;
            return {
                ...ref,
                direction: isSource ? 'outgoing' : 'incoming',
                relatedType: isSource ? ref.targetType : ref.sourceType,
                relatedId: isSource ? ref.targetId : ref.sourceId,
            };
        });
    }

    /**
     * Find a single cross-reference by ID
     */
    async findById(id: string) {
        requireUuid(id, 'id');
        const results = await db.select()
            .from(tunjukSilang)
            .where(and(
                eq(tunjukSilang.id, id),
                isNull(tunjukSilang.cancelledAt),
            ))
            .limit(1);
        return results[0] || null;
    }

    /**
     * Cancel a cross-reference while preserving its provenance
     */
    async cancel(
        id: string,
        cancelledBy: string,
        cancellationReason: string,
        ownerId: string | null = cancelledBy,
        auditContext?: CriticalAuditContext,
    ) {
        requireUuid(id, 'id');
        requireUuid(cancelledBy, 'cancelledBy');
        if (ownerId !== null) requireUuid(ownerId, 'ownerId');

        if (typeof cancellationReason !== 'string') {
            throw new ValidationError('Alasan pembatalan wajib berupa teks.');
        }
        const normalizedReason = cancellationReason.trim();
        if (normalizedReason.length < 10 || normalizedReason.length > 1000) {
            throw new ValidationError('Alasan pembatalan wajib diisi (10–1000 karakter).');
        }

        return db.transaction(async (tx) => {
            const [reference] = await tx
                .select()
                .from(tunjukSilang)
                .where(and(
                    eq(tunjukSilang.id, id),
                    isNull(tunjukSilang.cancelledAt),
                    ownerId === null ? undefined : eq(tunjukSilang.createdBy, ownerId),
                ))
                .limit(1);
            if (!reference) return null;
            if (!VALID_ENTITY_TYPES.includes(
                reference.sourceType as CrossReferenceEntityType,
            ) || !VALID_ENTITY_TYPES.includes(
                reference.targetType as CrossReferenceEntityType,
            )) {
                throw new ConflictError('Tunjuk silang memiliki tipe endpoint yang tidak valid.');
            }

            await lockEndpoints(
                tx,
                {
                    entityType: reference.sourceType as CrossReferenceEntityType,
                    entityId: reference.sourceId,
                },
                {
                    entityType: reference.targetType as CrossReferenceEntityType,
                    entityId: reference.targetId,
                },
            );

            // Lock in the same order as create: endpoint rows first, then the
            // relationship. The active/owner predicate is rechecked after the
            // endpoint locks so a concurrent cancellation fails closed.
            const [lockedReference] = await tx
                .select({ id: tunjukSilang.id })
                .from(tunjukSilang)
                .where(and(
                    eq(tunjukSilang.id, id),
                    isNull(tunjukSilang.cancelledAt),
                    ownerId === null ? undefined : eq(tunjukSilang.createdBy, ownerId),
                ))
                .limit(1)
                .for('update');
            if (!lockedReference) return null;

            const [cancelled] = await tx.update(tunjukSilang)
                .set({
                    cancelledAt: new Date(),
                    cancelledBy,
                    cancellationReason: normalizedReason,
                })
                .where(and(
                    eq(tunjukSilang.id, id),
                    isNull(tunjukSilang.cancelledAt),
                    ownerId === null ? undefined : eq(tunjukSilang.createdBy, ownerId),
                ))
                .returning();
            if (cancelled && auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'cancel',
                    entityType: 'tunjuk_silang',
                    entityId: id,
                    changes: {
                        before: reference,
                        after: {
                            cancelledAt: cancelled.cancelledAt,
                            cancelledBy: cancelled.cancelledBy,
                            cancellationReason: cancelled.cancellationReason,
                        },
                        fields: ['cancelledAt', 'cancelledBy', 'cancellationReason'],
                    },
                }, tx);
            }
            return cancelled || null;
        });
    }

    /**
     * List all cross-references with pagination
     */
    async findAll(filters: { jenisRelasi?: string; page?: number; limit?: number } = {}) {
        const { page = 1, limit = 20 } = filters;
        requirePagination(page, limit);
        if (filters.jenisRelasi && !VALID_RELASI_TYPES.includes(
            filters.jenisRelasi as typeof VALID_RELASI_TYPES[number],
        )) {
            throw new ValidationError('Jenis relasi tunjuk silang tidak valid.');
        }
        const offset = (page - 1) * limit;

        const conditions = [isNull(tunjukSilang.cancelledAt)];
        if (filters.jenisRelasi) conditions.push(eq(tunjukSilang.jenisRelasi, filters.jenisRelasi));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [data, totalResult] = await Promise.all([
            db.select()
                .from(tunjukSilang)
                .where(whereClause)
                .orderBy(desc(tunjukSilang.createdAt))
                .limit(limit)
                .offset(offset),
            db.select({ count: count() })
                .from(tunjukSilang)
                .where(whereClause),
        ]);

        return {
            data,
            total: totalResult[0]?.count || 0,
            page,
            limit,
            totalPages: Math.ceil((totalResult[0]?.count || 0) / limit),
        };
    }

    /**
     * Get statistics about cross-references
     */
    async getStats() {
        const [byRelasi, byType, totalResult] = await Promise.all([
            db.select({
                jenisRelasi: tunjukSilang.jenisRelasi,
                count: count(),
            })
                .from(tunjukSilang)
                .where(isNull(tunjukSilang.cancelledAt))
                .groupBy(tunjukSilang.jenisRelasi),

            db.select({
                sourceType: tunjukSilang.sourceType,
                count: count(),
            })
                .from(tunjukSilang)
                .where(isNull(tunjukSilang.cancelledAt))
                .groupBy(tunjukSilang.sourceType),

            db.select({ count: count() })
                .from(tunjukSilang)
                .where(isNull(tunjukSilang.cancelledAt)),
        ]);

        return { total: totalResult[0]?.count || 0, byRelasi, byType };
    }
}

export const tunjukSilangService = new TunjukSilangService();
