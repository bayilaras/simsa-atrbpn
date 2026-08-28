import { db } from '../config/database';
import { suratDistributions, NewSuratDistribution, SuratDistribution, suratMasuk, unitKerja, users } from '../db/schema';
import { eq, and, desc, sql, or, notInArray, inArray } from 'drizzle-orm';
import { NO_RECORD_UNIT_ACCESS, type RecordUnitScope } from '../utils/record-unit-scope';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';

export interface DistributionFilters {
    unitKerjaId?: string;
    status?: string;
    page?: number;
    limit?: number;
}

function incomingSecurityCondition(classes: string[] | null | undefined) {
    if (classes === undefined || classes === null) return undefined;
    if (classes.length === 0) return sql`false`;
    const normalized = sql<string>`CASE
        WHEN lower(coalesce(${suratMasuk.sifatSurat}, 'biasa'))
            IN ('biasa', 'biasa/terbuka', 'terbuka', 'segera', 'sangat_segera', 'undangan', 'penting')
        THEN 'biasa'
        ELSE replace(replace(lower(coalesce(${suratMasuk.sifatSurat}, 'biasa')), ' ', '_'), '-', '_')
    END`;
    return inArray(normalized, classes);
}

export class DistributionService {
    /**
     * Create a new distribution (send surat from Ditjen to target unit)
     */
    async distribute(data: {
        suratMasukId: string;
        sourceUnitId: string;
        targetUnitId: string;
        instruction?: string;
        ccUnits?: string[];
        sentBy?: string;
    }, auditContext?: CriticalAuditContext) {
        return db.transaction(async (tx) => {
        // The source unit supplied by the client must own the source letter. This
        // prevents an authorised unit from distributing another unit's letter by ID.
        const [sourceSurat] = await tx
            .select({ id: suratMasuk.id })
            .from(suratMasuk)
            .where(and(
                eq(suratMasuk.id, data.suratMasukId),
                eq(suratMasuk.unitKerjaId, data.sourceUnitId),
            ))
            .limit(1);
        if (!sourceSurat) {
            throw new Error('Surat not found');
        }

        // Check if already distributed to this target
        const [existing] = await tx
            .select()
            .from(suratDistributions)
            .where(and(
                eq(suratDistributions.suratMasukId, data.suratMasukId),
                eq(suratDistributions.targetUnitId, data.targetUnitId)
            ))
            .limit(1);

        if (existing) {
            throw new Error('Surat sudah didistribusikan ke unit ini');
        }

        const [result] = await tx
            .insert(suratDistributions)
            .values({
                suratMasukId: data.suratMasukId,
                sourceUnitId: data.sourceUnitId,
                targetUnitId: data.targetUnitId,
                instruction: data.instruction,
                ccUnits: data.ccUnits ? JSON.stringify(data.ccUnits) : null,
                sentBy: data.sentBy,
                status: 'sent',
                sentAt: new Date(),
            })
            .returning();

        if (auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'distribute',
                entityType: 'surat_distribution',
                entityId: result.id,
                changes: {
                    after: {
                        suratMasukId: data.suratMasukId,
                        sourceUnitId: data.sourceUnitId,
                        targetUnitId: data.targetUnitId,
                        instruction: data.instruction,
                        status: 'sent',
                    },
                },
            }, tx);
        }

        return result;
        });
    }

    /**
     * Get inbox (incoming distributions for a unit)
     */
    async findInbox(
        unitKerjaId: string,
        filters: DistributionFilters = {},
        securityClassifications?: string[] | null,
    ) {
        const { status, page = 1, limit = 20 } = filters;
        const offset = (page - 1) * limit;

        const conditions = [eq(suratDistributions.targetUnitId, unitKerjaId)];
        if (status) {
            conditions.push(eq(suratDistributions.status, status));
        }
        const classificationCondition = incomingSecurityCondition(securityClassifications);
        if (classificationCondition) conditions.push(classificationCondition);

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(suratDistributions)
            .innerJoin(suratMasuk, eq(suratDistributions.suratMasukId, suratMasuk.id))
            .where(and(...conditions));

        const data = await db
            .select({
                distribution: suratDistributions,
                surat: {
                    id: suratMasuk.id,
                    nomorSurat: suratMasuk.nomorSurat,
                    perihal: suratMasuk.perihal,
                    dari: suratMasuk.dari,
                    tanggalSurat: suratMasuk.tanggalSurat,
                    sifatSurat: suratMasuk.sifatSurat,
                },
                sourceUnit: {
                    id: unitKerja.id,
                    name: unitKerja.name,
                },
            })
            .from(suratDistributions)
            .innerJoin(suratMasuk, eq(suratDistributions.suratMasukId, suratMasuk.id))
            .innerJoin(unitKerja, eq(suratDistributions.sourceUnitId, unitKerja.id))
            .where(and(...conditions))
            .orderBy(desc(suratDistributions.sentAt))
            .limit(limit)
            .offset(offset);

        return {
            data: data.map(d => ({
                ...d.distribution,
                surat: d.surat,
                sourceUnit: d.sourceUnit,
            })),
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit),
            },
        };
    }

    /**
     * Get outbox (sent distributions from a unit)
     */
    async findOutbox(
        unitKerjaId: string,
        filters: DistributionFilters = {},
        securityClassifications?: string[] | null,
    ) {
        const { status, page = 1, limit = 20 } = filters;
        const offset = (page - 1) * limit;

        const conditions = [eq(suratDistributions.sourceUnitId, unitKerjaId)];
        if (status) {
            conditions.push(eq(suratDistributions.status, status));
        }
        const classificationCondition = incomingSecurityCondition(securityClassifications);
        if (classificationCondition) conditions.push(classificationCondition);

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(suratDistributions)
            .innerJoin(suratMasuk, eq(suratDistributions.suratMasukId, suratMasuk.id))
            .where(and(...conditions));

        const data = await db
            .select({
                distribution: suratDistributions,
                surat: {
                    id: suratMasuk.id,
                    nomorSurat: suratMasuk.nomorSurat,
                    perihal: suratMasuk.perihal,
                    dari: suratMasuk.dari,
                    tanggalSurat: suratMasuk.tanggalSurat,
                },
                targetUnit: {
                    id: unitKerja.id,
                    name: unitKerja.name,
                },
            })
            .from(suratDistributions)
            .innerJoin(suratMasuk, eq(suratDistributions.suratMasukId, suratMasuk.id))
            .innerJoin(unitKerja, eq(suratDistributions.targetUnitId, unitKerja.id))
            .where(and(...conditions))
            .orderBy(desc(suratDistributions.sentAt))
            .limit(limit)
            .offset(offset);

        return {
            data: data.map(d => ({
                ...d.distribution,
                surat: d.surat,
                targetUnit: d.targetUnit,
            })),
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit),
            },
        };
    }

    /**
     * Scope a distribution to the target unit when the caller resolved one
     * (super_admin passes nothing and may act on any unit).
     */
    private targetRecordWhere(distributionId: string, unitScope: RecordUnitScope) {
        const idCondition = eq(suratDistributions.id, distributionId);
        return unitScope === null
            ? idCondition
            : and(idCondition, eq(suratDistributions.targetUnitId, unitScope))!;
    }

    /** Read access is limited to a distribution's source or target unit. */
    private accessibleRecordWhere(distributionId: string, unitScope: RecordUnitScope) {
        const idCondition = eq(suratDistributions.id, distributionId);
        return unitScope === null
            ? idCondition
            : and(
                idCondition,
                or(
                    eq(suratDistributions.sourceUnitId, unitScope),
                    eq(suratDistributions.targetUnitId, unitScope),
                ),
            )!;
    }

    /**
     * Mark distribution as received by target unit
     */
    async receive(
        distributionId: string,
        receivedBy: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        auditContext?: CriticalAuditContext,
    ) {
        return db.transaction(async (tx) => {
        const [distribution] = await tx
            .select()
            .from(suratDistributions)
            .where(this.targetRecordWhere(distributionId, unitScope))
            .limit(1);

        if (!distribution) {
            throw new Error('Distribution not found');
        }
        if (distribution.status !== 'sent') {
            throw new Error('Distribution sudah diterima atau diproses');
        }

        const [result] = await tx
            .update(suratDistributions)
            .set({
                status: 'received',
                receivedAt: new Date(),
                receivedBy,
                updatedAt: new Date(),
            })
            // Repeat the status guard so a concurrent call cannot also win the check above
            .where(and(
                this.targetRecordWhere(distributionId, unitScope),
                eq(suratDistributions.status, 'sent'),
            ))
            .returning();

        if (!result) {
            throw new Error('Distribution sudah diterima atau diproses');
        }

        if (auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'receive_distribution',
                entityType: 'surat_distribution',
                entityId: distributionId,
                changes: { before: { status: distribution.status }, after: { status: 'received' } },
            }, tx);
        }

        return result;
        });
    }

    /**
     * Mark distribution as processed/completed
     */
    async process(
        distributionId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        auditContext?: CriticalAuditContext,
    ) {
        return db.transaction(async (tx) => {
        const [distribution] = await tx
            .select()
            .from(suratDistributions)
            .where(this.targetRecordWhere(distributionId, unitScope))
            .limit(1);

        if (!distribution) {
            throw new Error('Distribution not found');
        }
        if (distribution.status !== 'received') {
            throw new Error('Distribution hanya dapat diproses setelah diterima');
        }

        const [result] = await tx
            .update(suratDistributions)
            .set({
                status: 'processed',
                processedAt: new Date(),
                updatedAt: new Date(),
            })
            // Require the exact previous state so sent/rejected rows can never jump
            // directly to processed, including under concurrent requests.
            .where(and(
                this.targetRecordWhere(distributionId, unitScope),
                eq(suratDistributions.status, 'received'),
            ))
            .returning();

        if (!result) {
            throw new Error('Distribution hanya dapat diproses setelah diterima');
        }

        if (auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'process_distribution',
                entityType: 'surat_distribution',
                entityId: distributionId,
                changes: { before: { status: distribution.status }, after: { status: 'processed' } },
            }, tx);
        }

        return result;
        });
    }

    /**
     * Reject distribution (return to sender)
     */
    async reject(
        distributionId: string,
        reason: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        auditContext?: CriticalAuditContext,
    ) {
        return db.transaction(async (tx) => {
        const [distribution] = await tx
            .select()
            .from(suratDistributions)
            .where(this.targetRecordWhere(distributionId, unitScope))
            .limit(1);

        if (!distribution) {
            throw new Error('Distribution not found');
        }
        if (distribution.status === 'processed' || distribution.status === 'rejected') {
            throw new Error('Distribution tidak bisa ditolak');
        }

        const [result] = await tx
            .update(suratDistributions)
            .set({
                status: 'rejected',
                rejectionReason: reason,
                updatedAt: new Date(),
            })
            // Repeat the status guard so a concurrent call cannot also win the check above
            .where(and(
                this.targetRecordWhere(distributionId, unitScope),
                notInArray(suratDistributions.status, ['processed', 'rejected']),
            ))
            .returning();

        if (!result) {
            throw new Error('Distribution tidak bisa ditolak');
        }

        if (auditContext) {
            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'reject_distribution',
                entityType: 'surat_distribution',
                entityId: distributionId,
                changes: {
                    before: { status: distribution.status },
                    after: { status: 'rejected', reason },
                },
            }, tx);
        }

        return result;
        });
    }

    /**
     * Get distribution by ID with full details
     */
    async findById(id: string, unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS) {
        const [result] = await db
            .select({
                distribution: suratDistributions,
                surat: suratMasuk,
            })
            .from(suratDistributions)
            .innerJoin(suratMasuk, eq(suratDistributions.suratMasukId, suratMasuk.id))
            .where(this.accessibleRecordWhere(id, unitScope))
            .limit(1);

        return result ? { ...result.distribution, surat: result.surat } : null;
    }

    /**
     * Get statistics for dashboard
     */
    async getStats(unitKerjaId: string) {
        // Inbox stats (as target)
        const inboxStats = await db
            .select({
                total: sql<number>`count(*)::int`,
                pending: sql<number>`count(*) filter (where ${suratDistributions.status} = 'sent')::int`,
                received: sql<number>`count(*) filter (where ${suratDistributions.status} = 'received')::int`,
                processed: sql<number>`count(*) filter (where ${suratDistributions.status} = 'processed')::int`,
                rejected: sql<number>`count(*) filter (where ${suratDistributions.status} = 'rejected')::int`,
            })
            .from(suratDistributions)
            .where(eq(suratDistributions.targetUnitId, unitKerjaId));

        // Outbox stats (as source)
        const outboxStats = await db
            .select({
                total: sql<number>`count(*)::int`,
                pending: sql<number>`count(*) filter (where ${suratDistributions.status} = 'sent')::int`,
                processed: sql<number>`count(*) filter (where ${suratDistributions.status} = 'processed')::int`,
                rejected: sql<number>`count(*) filter (where ${suratDistributions.status} = 'rejected')::int`,
            })
            .from(suratDistributions)
            .where(eq(suratDistributions.sourceUnitId, unitKerjaId));

        return {
            inbox: inboxStats[0],
            outbox: outboxStats[0],
        };
    }

    /**
     * Get distributable units (units that can receive distributions)
     */
    async getDistributableUnits(excludeUnitId?: string) {
        const conditions = [eq(unitKerja.canReceiveDistribution, true)];
        if (excludeUnitId) {
            conditions.push(sql`${unitKerja.id} != ${excludeUnitId}`);
        }

        const units = await db
            .select({
                id: unitKerja.id,
                name: unitKerja.name,
                unitType: unitKerja.unitType,
            })
            .from(unitKerja)
            .where(and(...conditions))
            .orderBy(unitKerja.name);

        return units;
    }

    /**
     * Check if surat is already distributed
     */
    async isDistributed(
        suratMasukId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
    ) {
        const conditions = [eq(suratDistributions.suratMasukId, suratMasukId)];
        if (unitScope !== null) {
            conditions.push(or(
                eq(suratDistributions.sourceUnitId, unitScope),
                eq(suratDistributions.targetUnitId, unitScope),
            )!);
        }
        const [result] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(suratDistributions)
            .where(and(...conditions));

        return result.count > 0;
    }

    /**
     * Get distribution history for a surat
     */
    async getHistoryBySurat(
        suratMasukId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
    ) {
        const conditions = [eq(suratDistributions.suratMasukId, suratMasukId)];
        if (unitScope !== null) {
            conditions.push(or(
                eq(suratDistributions.sourceUnitId, unitScope),
                eq(suratDistributions.targetUnitId, unitScope),
            )!);
        }
        return await db
            .select({
                distribution: suratDistributions,
                targetUnit: {
                    id: unitKerja.id,
                    name: unitKerja.name,
                },
            })
            .from(suratDistributions)
            .innerJoin(unitKerja, eq(suratDistributions.targetUnitId, unitKerja.id))
            .where(and(...conditions))
            .orderBy(desc(suratDistributions.sentAt));
    }
}

export const distributionService = new DistributionService();
