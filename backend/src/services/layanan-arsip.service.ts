
import { db } from '../config/database';
import { layananArsip, NewLayananArsip } from '../db/schema/layanan-arsip';
import { eq, desc, and, ilike, inArray, sql } from 'drizzle-orm';
import { arsip } from '../db/schema/arsip';
import {
    NO_RECORD_UNIT_ACCESS,
    scopedRecordByIdWhere,
    type RecordUnitScope,
} from '../utils/record-unit-scope';
import { NotFoundError } from '../utils/errors';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';

interface LayananArsipFilters {
    page?: number;
    limit?: number;
    status?: string;
    jenisLayanan?: string;
    userId?: string; // Filter by requester
}

export interface LayananArsipAccess {
    unitScope: RecordUnitScope;
    requesterId?: string;
    canReviewUnit?: boolean;
    securityClassifications?: string[] | null;
}

function archiveSecurityCondition(classes: string[] | null | undefined) {
    if (classes === undefined || classes === null) return undefined;
    if (classes.length === 0) return sql`false`;
    return inArray(
        sql<string>`lower(coalesce(${arsip.klasifikasiKeamanan}, 'biasa'))`,
        classes,
    );
}

export class LayananArsipService {
    private accessibleArsipCondition(
        unitScope: RecordUnitScope,
        securityClassifications?: string[] | null,
    ) {
        const archiveConditions = [];
        if (unitScope !== null) archiveConditions.push(eq(arsip.unitKerjaId, unitScope));
        const securityCondition = archiveSecurityCondition(securityClassifications);
        if (securityCondition) archiveConditions.push(securityCondition);
        if (archiveConditions.length === 0) return undefined;

        return inArray(
            layananArsip.arsipId,
            db.select({ id: arsip.id })
                .from(arsip)
                .where(and(...archiveConditions)),
        );
    }

    private accessibleRequestWhere(id: string, access: LayananArsipAccess) {
        const conditions = [eq(layananArsip.id, id)];
        const archiveAccess = this.accessibleArsipCondition(
            access.unitScope,
            access.securityClassifications,
        );
        if (archiveAccess) conditions.push(archiveAccess);
        if (!access.canReviewUnit) {
            conditions.push(eq(layananArsip.diajukanOleh, access.requesterId || ''));
        }
        return and(...conditions)!;
    }

    async create(
        data: NewLayananArsip,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
        auditContext?: CriticalAuditContext,
    ) {
        return await db.transaction(async (tx) => {
            const archiveConditions = [scopedRecordByIdWhere(
                arsip.id,
                data.arsipId,
                arsip.unitKerjaId,
                unitScope,
            )];
            const securityCondition = archiveSecurityCondition(securityClassifications);
            if (securityCondition) archiveConditions.push(securityCondition);
            const [accessibleArsip] = await tx.select({ id: arsip.id })
                .from(arsip)
                .where(and(...archiveConditions))
                .limit(1);
            if (!accessibleArsip) throw new NotFoundError('Arsip');

            const [result] = await tx.insert(layananArsip).values({
                ...data,
                updatedAt: new Date(),
            }).returning();
            if (auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'create',
                    entityType: 'layanan_arsip',
                    entityId: result.id,
                    changes: {
                        after: {
                            arsipId: result.arsipId,
                            jenisLayanan: result.jenisLayanan,
                            status: result.status,
                        },
                    },
                }, tx);
            }
            return result;
        });
    }

    async findAll(
        filters: LayananArsipFilters = {},
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ) {
        const { page = 1, limit = 20, status, jenisLayanan, userId } = filters;
        const offset = (page - 1) * limit;

        const conditions = [];
        if (status) conditions.push(eq(layananArsip.status, status));
        if (jenisLayanan) conditions.push(eq(layananArsip.jenisLayanan, jenisLayanan));
        if (userId) conditions.push(eq(layananArsip.diajukanOleh, userId));
        const archiveAccess = this.accessibleArsipCondition(unitScope, securityClassifications);
        if (archiveAccess) conditions.push(archiveAccess);

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [data, totalResult] = await Promise.all([
            db.query.layananArsip.findMany({
                where: whereClause,
                with: {
                    arsip: {
                        columns: {
                            id: true,
                            nomorBerkas: true,
                            uraianBerkas: true,
                        }
                    },
                    pemohon: {
                        columns: {
                            id: true,
                            name: true,
                            unitKerjaId: true,
                        }
                    },
                    penyetuju: {
                        columns: {
                            id: true,
                            name: true,
                        }
                    }
                },
                orderBy: [desc(layananArsip.createdAt)],
                limit,
                offset,
            }),
            db.select({ count: sql<number>`count(*)` })
                .from(layananArsip)
                .where(whereClause),
        ]);

        return {
            data,
            total: Number(totalResult[0]?.count || 0),
            page,
            limit,
            totalPages: Math.ceil(Number(totalResult[0]?.count || 0) / limit),
        };
    }

    async findById(
        id: string,
        access: LayananArsipAccess = { unitScope: NO_RECORD_UNIT_ACCESS },
    ) {
        return await db.query.layananArsip.findFirst({
            where: this.accessibleRequestWhere(id, access),
            with: {
                arsip: true,
                pemohon: true,
                penyetuju: true,
            }
        });
    }

    async updateStatus(
        id: string,
        status: string,
        approvedBy?: string,
        notes?: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        expectedStatus?: string,
        securityClassifications?: string[] | null,
        auditContext?: CriticalAuditContext,
    ) {
        const updateData: any = {
            status,
            updatedAt: new Date(),
        };

        if (status === 'selesai' || status === 'diproses' || status === 'ditolak') {
            if (approvedBy) updateData.disetujuiOleh = approvedBy;
            if (notes) updateData.catatanPersetujuan = notes;
            updateData.tanggalPersetujuan = new Date();
        }

        const conditions = [eq(layananArsip.id, id)];
        const archiveAccess = this.accessibleArsipCondition(unitScope, securityClassifications);
        if (archiveAccess) conditions.push(archiveAccess);
        if (expectedStatus) conditions.push(eq(layananArsip.status, expectedStatus));

        return db.transaction(async (tx) => {
            const [result] = await tx.update(layananArsip)
                .set(updateData)
                .where(and(...conditions))
                .returning();

            if (!result) throw new NotFoundError('Layanan arsip');
            if (auditContext) {
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'status_change',
                    entityType: 'layanan_arsip',
                    entityId: id,
                    changes: {
                        before: { status: expectedStatus || null },
                        after: { status },
                        notes: notes || null,
                    },
                }, tx);
            }
            return result;
        });
    }

    async delete(
        id: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ) {
        const conditions = [eq(layananArsip.id, id)];
        const archiveAccess = this.accessibleArsipCondition(unitScope, securityClassifications);
        if (archiveAccess) conditions.push(archiveAccess);
        const [deleted] = await db.delete(layananArsip)
            .where(and(...conditions))
            .returning({ id: layananArsip.id });
        if (!deleted) throw new NotFoundError('Layanan arsip');
    }
}

export const layananArsipService = new LayananArsipService();
