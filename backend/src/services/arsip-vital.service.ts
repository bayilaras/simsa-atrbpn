import { db } from '../config/database';
import { arsipVital, NewArsipVital, ArsipVital, arsip } from '../db/schema';
import { eq, and, desc, sql, lte, ilike, or, inArray } from 'drizzle-orm';
import {
    scopedRecordByIdWhere,
    type RecordUnitScope,
} from '../utils/record-unit-scope.js';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';

interface ArsipVitalFilters {
    unitKerjaId?: string;
    kategoriVital?: string;
    tingkatKekritisan?: string;
    statusProteksi?: string;
    search?: string;
    page?: number;
    limit?: number;
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

class ArsipVitalService {

    // List all arsip vital with pagination and filters
    async findAll(filters: ArsipVitalFilters) {
        const {
            unitKerjaId,
            kategoriVital,
            tingkatKekritisan,
            statusProteksi,
            search,
            page = 1,
            limit = 20,
            securityClassifications,
        } = filters;

        const conditions = [];

        if (unitKerjaId) {
            conditions.push(eq(arsipVital.unitKerjaId, unitKerjaId));
        }
        if (kategoriVital) {
            conditions.push(eq(arsipVital.kategoriVital, kategoriVital));
        }
        if (tingkatKekritisan) {
            conditions.push(eq(arsipVital.tingkatKekritisan, tingkatKekritisan));
        }
        if (statusProteksi) {
            conditions.push(eq(arsipVital.statusProteksi, statusProteksi));
        }
        if (search) {
            conditions.push(
                or(
                    ilike(arsipVital.alasanPenetapan, `%${search}%`),
                    ilike(arsipVital.penanggungJawab, `%${search}%`),
                    ilike(arsipVital.lokasiBackup, `%${search}%`)
                )!
            );
        }
        conditions.push(archiveSecurityCondition(securityClassifications));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [data, countResult] = await Promise.all([
            db.select({
                id: arsipVital.id,
                arsipId: arsipVital.arsipId,
                unitKerjaId: arsipVital.unitKerjaId,
                kategoriVital: arsipVital.kategoriVital,
                tingkatKekritisan: arsipVital.tingkatKekritisan,
                alasanPenetapan: arsipVital.alasanPenetapan,
                metodeProteksi: arsipVital.metodeProteksi,
                lokasiBackup: arsipVital.lokasiBackup,
                mediaBackup: arsipVital.mediaBackup,
                jadwalBackup: arsipVital.jadwalBackup,
                tanggalPenetapan: arsipVital.tanggalPenetapan,
                tanggalReviewSelanjutnya: arsipVital.tanggalReviewSelanjutnya,
                statusProteksi: arsipVital.statusProteksi,
                penanggungJawab: arsipVital.penanggungJawab,
                createdAt: arsipVital.createdAt,
                // Joined arsip info
                nomorBerkas: arsip.nomorBerkas,
                kodeKlasifikasi: arsip.kodeKlasifikasi,
                uraianBerkas: arsip.uraianBerkas,
                nomorSuratOriginal: arsip.nomorSuratOriginal,
                perihalOriginal: arsip.perihalOriginal,
                kurunWaktu: arsip.kurunWaktu,
            })
                .from(arsipVital)
                .innerJoin(arsip, and(
                    eq(arsipVital.arsipId, arsip.id),
                    eq(arsip.unitKerjaId, arsipVital.unitKerjaId),
                ))
                .where(whereClause)
                .orderBy(desc(arsipVital.createdAt))
                .limit(limit)
                .offset((page - 1) * limit),

            db.select({ count: sql<number>`count(*)::int` })
                .from(arsipVital)
                .innerJoin(arsip, and(
                    eq(arsipVital.arsipId, arsip.id),
                    eq(arsip.unitKerjaId, arsipVital.unitKerjaId),
                ))
                .where(whereClause),
        ]);

        const total = countResult[0]?.count ?? 0;

        return {
            data,
            total,
            page,
            totalPages: Math.ceil(total / limit),
        };
    }

    // Get single arsip vital with arsip details
    async findById(
        id: string,
        unitScope: RecordUnitScope,
        securityClassifications?: string[] | null,
    ) {
        const [result] = await db
            .select({
                id: arsipVital.id,
                arsipId: arsipVital.arsipId,
                unitKerjaId: arsipVital.unitKerjaId,
                kategoriVital: arsipVital.kategoriVital,
                tingkatKekritisan: arsipVital.tingkatKekritisan,
                alasanPenetapan: arsipVital.alasanPenetapan,
                metodeProteksi: arsipVital.metodeProteksi,
                lokasiBackup: arsipVital.lokasiBackup,
                mediaBackup: arsipVital.mediaBackup,
                jadwalBackup: arsipVital.jadwalBackup,
                tanggalPenetapan: arsipVital.tanggalPenetapan,
                tanggalReviewSelanjutnya: arsipVital.tanggalReviewSelanjutnya,
                statusProteksi: arsipVital.statusProteksi,
                penanggungJawab: arsipVital.penanggungJawab,
                createdBy: arsipVital.createdBy,
                createdAt: arsipVital.createdAt,
                updatedAt: arsipVital.updatedAt,
                // Joined arsip info
                nomorBerkas: arsip.nomorBerkas,
                kodeKlasifikasi: arsip.kodeKlasifikasi,
                uraianBerkas: arsip.uraianBerkas,
                uraianItem: arsip.uraianItem,
                nomorSuratOriginal: arsip.nomorSuratOriginal,
                tanggalSuratOriginal: arsip.tanggalSuratOriginal,
                perihalOriginal: arsip.perihalOriginal,
                jenisArsip: arsip.jenisArsip,
            })
            .from(arsipVital)
            .innerJoin(arsip, and(
                eq(arsipVital.arsipId, arsip.id),
                eq(arsip.unitKerjaId, arsipVital.unitKerjaId),
            ))
            .where(and(
                scopedRecordByIdWhere(
                    arsipVital.id,
                    id,
                    arsipVital.unitKerjaId,
                    unitScope,
                ),
                archiveSecurityCondition(securityClassifications),
            ))
            .limit(1);

        return result || null;
    }

    // Designate an archive as vital
    async create(data: NewArsipVital, auditContext: CriticalAuditContext) {
        return await db.transaction(async (tx: any) => {
            const [result] = await tx.insert(arsipVital).values({
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
            }).returning();

            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'create',
                entityType: 'arsip',
                entityId: result.arsipId,
                changes: {
                    after: result,
                    designation: 'vital',
                    designationId: result.id,
                },
            }, tx);

            return result;
        });
    }

    // Update arsip vital
    async update(
        id: string,
        data: Partial<ArsipVital>,
        unitScope: RecordUnitScope,
        auditContext: CriticalAuditContext,
    ) {
        return await db.transaction(async (tx: any) => {
            const targetWhere = scopedRecordByIdWhere(
                arsipVital.id,
                id,
                arsipVital.unitKerjaId,
                unitScope,
            );
            const [existing] = await tx
                .select()
                .from(arsipVital)
                .where(targetWhere)
                .limit(1)
                .for('update');

            if (!existing) return null;

            const [result] = await tx
                .update(arsipVital)
                .set({ ...data, updatedAt: new Date() })
                .where(targetWhere)
                .returning();

            if (!result) return null;

            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'update',
                entityType: 'arsip',
                entityId: result.arsipId,
                changes: {
                    before: existing,
                    after: result,
                    fields: Object.keys(data),
                    designation: 'vital',
                    designationId: result.id,
                },
            }, tx);

            return result;
        });
    }

    // Remove vital designation
    async delete(
        id: string,
        unitScope: RecordUnitScope,
        auditContext: CriticalAuditContext,
    ) {
        return await db.transaction(async (tx: any) => {
            const targetWhere = scopedRecordByIdWhere(
                arsipVital.id,
                id,
                arsipVital.unitKerjaId,
                unitScope,
            );
            const [existing] = await tx
                .select()
                .from(arsipVital)
                .where(targetWhere)
                .limit(1)
                .for('update');

            if (!existing) return null;

            const [result] = await tx
                .delete(arsipVital)
                .where(targetWhere)
                .returning();

            if (!result) return null;

            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'delete',
                entityType: 'arsip',
                entityId: existing.arsipId,
                changes: {
                    before: existing,
                    designation: 'vital',
                    designationId: existing.id,
                },
            }, tx);

            return result;
        });
    }

    // Get statistics for dashboard
    async getStats(unitKerjaId: string, securityClassifications?: string[] | null) {
        const conditions = [
            eq(arsipVital.unitKerjaId, unitKerjaId),
            archiveSecurityCondition(securityClassifications),
        ];

        const [total, byKategori, byStatus, byKekritisan] = await Promise.all([
            db.select({ count: sql<number>`count(*)::int` })
                .from(arsipVital)
                .innerJoin(arsip, eq(arsipVital.arsipId, arsip.id))
                .where(and(...conditions)),

            db.select({
                kategori: arsipVital.kategoriVital,
                count: sql<number>`count(*)::int`,
            })
                .from(arsipVital)
                .innerJoin(arsip, eq(arsipVital.arsipId, arsip.id))
                .where(and(...conditions))
                .groupBy(arsipVital.kategoriVital),

            db.select({
                status: arsipVital.statusProteksi,
                count: sql<number>`count(*)::int`,
            })
                .from(arsipVital)
                .innerJoin(arsip, eq(arsipVital.arsipId, arsip.id))
                .where(and(...conditions))
                .groupBy(arsipVital.statusProteksi),

            db.select({
                tingkat: arsipVital.tingkatKekritisan,
                count: sql<number>`count(*)::int`,
            })
                .from(arsipVital)
                .innerJoin(arsip, eq(arsipVital.arsipId, arsip.id))
                .where(and(...conditions))
                .groupBy(arsipVital.tingkatKekritisan),
        ]);

        return {
            total: total[0]?.count ?? 0,
            byKategori,
            byStatus,
            byKekritisan,
        };
    }

    // Get arsip vital due for review
    async getDueForReview(
        unitKerjaId: string,
        daysAhead: number = 30,
        securityClassifications?: string[] | null,
    ) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + daysAhead);

        const results = await db
            .select({
                id: arsipVital.id,
                arsipId: arsipVital.arsipId,
                kategoriVital: arsipVital.kategoriVital,
                tingkatKekritisan: arsipVital.tingkatKekritisan,
                statusProteksi: arsipVital.statusProteksi,
                tanggalReviewSelanjutnya: arsipVital.tanggalReviewSelanjutnya,
                penanggungJawab: arsipVital.penanggungJawab,
                nomorBerkas: arsip.nomorBerkas,
                uraianBerkas: arsip.uraianBerkas,
                nomorSuratOriginal: arsip.nomorSuratOriginal,
            })
            .from(arsipVital)
            .innerJoin(arsip, and(
                eq(arsipVital.arsipId, arsip.id),
                eq(arsip.unitKerjaId, arsipVital.unitKerjaId),
            ))
            .where(
                and(
                    eq(arsipVital.unitKerjaId, unitKerjaId),
                    lte(arsipVital.tanggalReviewSelanjutnya, futureDate.toISOString().split('T')[0]),
                    archiveSecurityCondition(securityClassifications),
                )
            )
            .orderBy(arsipVital.tanggalReviewSelanjutnya);

        return results;
    }
}

export const arsipVitalService = new ArsipVitalService();
