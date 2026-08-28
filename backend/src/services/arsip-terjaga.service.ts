import { db } from '../config/database';
import { arsipTerjaga, NewArsipTerjaga, ArsipTerjaga, arsip } from '../db/schema';
import { eq, and, desc, sql, lte, ilike, or, inArray } from 'drizzle-orm';
import {
    scopedRecordByIdWhere,
    type RecordUnitScope,
} from '../utils/record-unit-scope.js';
import auditLogService, { type CriticalAuditContext } from './audit-log.service.js';

interface ArsipTerjagaFilters {
    unitKerjaId?: string;
    kategoriTerjaga?: string;
    statusPelaporan?: string;
    statusKepatuhan?: string;
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

class ArsipTerjagaService {

    // List all arsip terjaga with pagination and filters
    async findAll(filters: ArsipTerjagaFilters) {
        const {
            unitKerjaId,
            kategoriTerjaga,
            statusPelaporan,
            statusKepatuhan,
            search,
            page = 1,
            limit = 20,
            securityClassifications,
        } = filters;

        const conditions = [];

        if (unitKerjaId) {
            conditions.push(eq(arsipTerjaga.unitKerjaId, unitKerjaId));
        }
        if (kategoriTerjaga) {
            conditions.push(eq(arsipTerjaga.kategoriTerjaga, kategoriTerjaga));
        }
        if (statusPelaporan) {
            conditions.push(eq(arsipTerjaga.statusPelaporan, statusPelaporan));
        }
        if (statusKepatuhan) {
            conditions.push(eq(arsipTerjaga.statusKepatuhan, statusKepatuhan));
        }
        if (search) {
            conditions.push(
                or(
                    ilike(arsipTerjaga.dasarHukum, `%${search}%`),
                    ilike(arsipTerjaga.uraianIsi, `%${search}%`),
                    ilike(arsipTerjaga.catatan, `%${search}%`),
                    ilike(arsipTerjaga.nomorLaporanANRI, `%${search}%`)
                )!
            );
        }
        conditions.push(archiveSecurityCondition(securityClassifications));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [data, countResult] = await Promise.all([
            db.select({
                id: arsipTerjaga.id,
                arsipId: arsipTerjaga.arsipId,
                unitKerjaId: arsipTerjaga.unitKerjaId,
                kategoriTerjaga: arsipTerjaga.kategoriTerjaga,
                dasarHukum: arsipTerjaga.dasarHukum,
                uraianIsi: arsipTerjaga.uraianIsi,
                statusPelaporan: arsipTerjaga.statusPelaporan,
                tanggalPelaporan: arsipTerjaga.tanggalPelaporan,
                nomorLaporanANRI: arsipTerjaga.nomorLaporanANRI,
                periodePelaporanHari: arsipTerjaga.periodePelaporanHari,
                tanggalPenetapan: arsipTerjaga.tanggalPenetapan,
                tanggalReviewSelanjutnya: arsipTerjaga.tanggalReviewSelanjutnya,
                statusKepatuhan: arsipTerjaga.statusKepatuhan,
                catatan: arsipTerjaga.catatan,
                createdAt: arsipTerjaga.createdAt,
                // Joined arsip info
                nomorBerkas: arsip.nomorBerkas,
                kodeKlasifikasi: arsip.kodeKlasifikasi,
                uraianBerkas: arsip.uraianBerkas,
                nomorSuratOriginal: arsip.nomorSuratOriginal,
                perihalOriginal: arsip.perihalOriginal,
                kurunWaktu: arsip.kurunWaktu,
            })
                .from(arsipTerjaga)
                .innerJoin(arsip, and(
                    eq(arsipTerjaga.arsipId, arsip.id),
                    eq(arsip.unitKerjaId, arsipTerjaga.unitKerjaId),
                ))
                .where(whereClause)
                .orderBy(desc(arsipTerjaga.createdAt))
                .limit(limit)
                .offset((page - 1) * limit),

            db.select({ count: sql<number>`count(*)::int` })
                .from(arsipTerjaga)
                .innerJoin(arsip, and(
                    eq(arsipTerjaga.arsipId, arsip.id),
                    eq(arsip.unitKerjaId, arsipTerjaga.unitKerjaId),
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

    // Get single arsip terjaga with arsip details
    async findById(
        id: string,
        unitScope: RecordUnitScope,
        securityClassifications?: string[] | null,
    ) {
        const [result] = await db
            .select({
                id: arsipTerjaga.id,
                arsipId: arsipTerjaga.arsipId,
                unitKerjaId: arsipTerjaga.unitKerjaId,
                kategoriTerjaga: arsipTerjaga.kategoriTerjaga,
                dasarHukum: arsipTerjaga.dasarHukum,
                uraianIsi: arsipTerjaga.uraianIsi,
                statusPelaporan: arsipTerjaga.statusPelaporan,
                tanggalPelaporan: arsipTerjaga.tanggalPelaporan,
                nomorLaporanANRI: arsipTerjaga.nomorLaporanANRI,
                periodePelaporanHari: arsipTerjaga.periodePelaporanHari,
                tanggalPenetapan: arsipTerjaga.tanggalPenetapan,
                tanggalReviewSelanjutnya: arsipTerjaga.tanggalReviewSelanjutnya,
                statusKepatuhan: arsipTerjaga.statusKepatuhan,
                catatan: arsipTerjaga.catatan,
                createdBy: arsipTerjaga.createdBy,
                createdAt: arsipTerjaga.createdAt,
                updatedAt: arsipTerjaga.updatedAt,
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
            .from(arsipTerjaga)
            .innerJoin(arsip, and(
                eq(arsipTerjaga.arsipId, arsip.id),
                eq(arsip.unitKerjaId, arsipTerjaga.unitKerjaId),
            ))
            .where(and(
                scopedRecordByIdWhere(
                    arsipTerjaga.id,
                    id,
                    arsipTerjaga.unitKerjaId,
                    unitScope,
                ),
                archiveSecurityCondition(securityClassifications),
            ))
            .limit(1);

        return result || null;
    }

    // Designate an archive as terjaga
    async create(data: NewArsipTerjaga, auditContext: CriticalAuditContext) {
        return await db.transaction(async (tx: any) => {
            const [result] = await tx.insert(arsipTerjaga).values({
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
                    designation: 'terjaga',
                    designationId: result.id,
                },
            }, tx);

            return result;
        });
    }

    // Update arsip terjaga
    async update(
        id: string,
        data: Partial<ArsipTerjaga>,
        unitScope: RecordUnitScope,
        auditContext: CriticalAuditContext,
    ) {
        return await db.transaction(async (tx: any) => {
            const targetWhere = scopedRecordByIdWhere(
                arsipTerjaga.id,
                id,
                arsipTerjaga.unitKerjaId,
                unitScope,
            );
            const [existing] = await tx
                .select()
                .from(arsipTerjaga)
                .where(targetWhere)
                .limit(1)
                .for('update');

            if (!existing) return null;

            const [result] = await tx
                .update(arsipTerjaga)
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
                    designation: 'terjaga',
                    designationId: result.id,
                },
            }, tx);

            return result;
        });
    }

    // Remove terjaga designation
    async delete(
        id: string,
        unitScope: RecordUnitScope,
        auditContext: CriticalAuditContext,
    ) {
        return await db.transaction(async (tx: any) => {
            const targetWhere = scopedRecordByIdWhere(
                arsipTerjaga.id,
                id,
                arsipTerjaga.unitKerjaId,
                unitScope,
            );
            const [existing] = await tx
                .select()
                .from(arsipTerjaga)
                .where(targetWhere)
                .limit(1)
                .for('update');

            if (!existing) return null;

            const [result] = await tx
                .delete(arsipTerjaga)
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
                    designation: 'terjaga',
                    designationId: existing.id,
                },
            }, tx);

            return result;
        });
    }

    // Mark as reported to ANRI
    async markAsReported(
        id: string,
        nomorLaporan: string,
        tanggalPelaporan: string,
        unitScope: RecordUnitScope,
        auditContext: CriticalAuditContext,
    ) {
        return await db.transaction(async (tx: any) => {
            const targetWhere = scopedRecordByIdWhere(
                arsipTerjaga.id,
                id,
                arsipTerjaga.unitKerjaId,
                unitScope,
            );
            const [existing] = await tx
                .select()
                .from(arsipTerjaga)
                .where(targetWhere)
                .limit(1)
                .for('update');

            if (!existing) return null;

            const [result] = await tx
                .update(arsipTerjaga)
                .set({
                    statusPelaporan: 'dilaporkan',
                    nomorLaporanANRI: nomorLaporan,
                    tanggalPelaporan: tanggalPelaporan,
                    statusKepatuhan: 'patuh',
                    updatedAt: new Date(),
                })
                .where(targetWhere)
                .returning();

            if (!result) return null;

            await auditLogService.logActionOrThrow({
                ...auditContext,
                action: 'status_change',
                entityType: 'arsip',
                entityId: result.arsipId,
                changes: {
                    before: existing,
                    after: result,
                    fields: [
                        'statusPelaporan',
                        'nomorLaporanANRI',
                        'tanggalPelaporan',
                        'statusKepatuhan',
                    ],
                    designation: 'terjaga',
                    designationId: result.id,
                },
            }, tx);

            return result;
        });
    }

    // Get statistics for dashboard
    async getStats(unitKerjaId: string, securityClassifications?: string[] | null) {
        const conditions = [
            eq(arsipTerjaga.unitKerjaId, unitKerjaId),
            archiveSecurityCondition(securityClassifications),
        ];

        const [total, byKategori, byPelaporan, byKepatuhan] = await Promise.all([
            db.select({ count: sql<number>`count(*)::int` })
                .from(arsipTerjaga)
                .innerJoin(arsip, eq(arsipTerjaga.arsipId, arsip.id))
                .where(and(...conditions)),

            db.select({
                kategori: arsipTerjaga.kategoriTerjaga,
                count: sql<number>`count(*)::int`,
            })
                .from(arsipTerjaga)
                .innerJoin(arsip, eq(arsipTerjaga.arsipId, arsip.id))
                .where(and(...conditions))
                .groupBy(arsipTerjaga.kategoriTerjaga),

            db.select({
                status: arsipTerjaga.statusPelaporan,
                count: sql<number>`count(*)::int`,
            })
                .from(arsipTerjaga)
                .innerJoin(arsip, eq(arsipTerjaga.arsipId, arsip.id))
                .where(and(...conditions))
                .groupBy(arsipTerjaga.statusPelaporan),

            db.select({
                status: arsipTerjaga.statusKepatuhan,
                count: sql<number>`count(*)::int`,
            })
                .from(arsipTerjaga)
                .innerJoin(arsip, eq(arsipTerjaga.arsipId, arsip.id))
                .where(and(...conditions))
                .groupBy(arsipTerjaga.statusKepatuhan),
        ]);

        return {
            total: total[0]?.count ?? 0,
            byKategori,
            byPelaporan,
            byKepatuhan,
        };
    }

    // Get arsip terjaga approaching reporting deadline
    async getDueForReporting(
        unitKerjaId: string,
        daysAhead: number = 30,
        securityClassifications?: string[] | null,
    ) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + daysAhead);
        const futureDateStr = futureDate.toISOString().split('T')[0];

        const results = await db
            .select({
                id: arsipTerjaga.id,
                arsipId: arsipTerjaga.arsipId,
                kategoriTerjaga: arsipTerjaga.kategoriTerjaga,
                statusPelaporan: arsipTerjaga.statusPelaporan,
                tanggalPelaporan: arsipTerjaga.tanggalPelaporan,
                tanggalReviewSelanjutnya: arsipTerjaga.tanggalReviewSelanjutnya,
                nomorLaporanANRI: arsipTerjaga.nomorLaporanANRI,
                statusKepatuhan: arsipTerjaga.statusKepatuhan,
                nomorBerkas: arsip.nomorBerkas,
                uraianBerkas: arsip.uraianBerkas,
                nomorSuratOriginal: arsip.nomorSuratOriginal,
            })
            .from(arsipTerjaga)
            .innerJoin(arsip, and(
                eq(arsipTerjaga.arsipId, arsip.id),
                eq(arsip.unitKerjaId, arsipTerjaga.unitKerjaId),
            ))
            .where(
                and(
                    eq(arsipTerjaga.unitKerjaId, unitKerjaId),
                    eq(arsipTerjaga.statusPelaporan, 'belum_dilaporkan'),
                    archiveSecurityCondition(securityClassifications),
                    sql`COALESCE(
                        ${arsipTerjaga.tanggalReviewSelanjutnya},
                        ${arsipTerjaga.tanggalPenetapan} + make_interval(days => COALESCE(${arsipTerjaga.periodePelaporanHari}, 365))
                    ) <= ${futureDateStr}::date`
                )
            )
            .orderBy(arsipTerjaga.tanggalPenetapan);

        return results;
    }

    // Generate ANRI report data
    async generateLaporanANRI(
        unitKerjaId: string,
        tahun?: number,
        securityClassifications?: string[] | null,
    ) {
        const conditions = [
            eq(arsipTerjaga.unitKerjaId, unitKerjaId),
            archiveSecurityCondition(securityClassifications),
        ];
        if (tahun) {
            conditions.push(sql`EXTRACT(YEAR FROM ${arsipTerjaga.tanggalPenetapan}) = ${tahun}`);
        }

        const results = await db
            .select({
                id: arsipTerjaga.id,
                arsipId: arsipTerjaga.arsipId,
                kategoriTerjaga: arsipTerjaga.kategoriTerjaga,
                dasarHukum: arsipTerjaga.dasarHukum,
                uraianIsi: arsipTerjaga.uraianIsi,
                statusPelaporan: arsipTerjaga.statusPelaporan,
                tanggalPelaporan: arsipTerjaga.tanggalPelaporan,
                nomorLaporanANRI: arsipTerjaga.nomorLaporanANRI,
                tanggalPenetapan: arsipTerjaga.tanggalPenetapan,
                statusKepatuhan: arsipTerjaga.statusKepatuhan,
                catatan: arsipTerjaga.catatan,
                // Arsip details
                nomorBerkas: arsip.nomorBerkas,
                kodeKlasifikasi: arsip.kodeKlasifikasi,
                uraianBerkas: arsip.uraianBerkas,
                nomorSuratOriginal: arsip.nomorSuratOriginal,
                tanggalSuratOriginal: arsip.tanggalSuratOriginal,
                perihalOriginal: arsip.perihalOriginal,
                kurunWaktu: arsip.kurunWaktu,
                jumlah: arsip.jumlah,
            })
            .from(arsipTerjaga)
            .innerJoin(arsip, and(
                eq(arsipTerjaga.arsipId, arsip.id),
                eq(arsip.unitKerjaId, arsipTerjaga.unitKerjaId),
            ))
            .where(and(...conditions))
            .orderBy(arsipTerjaga.kategoriTerjaga, arsipTerjaga.tanggalPenetapan);

        // Group by kategori for the report
        const grouped: Record<string, typeof results> = {};
        for (const item of results) {
            const kat = item.kategoriTerjaga;
            if (!grouped[kat]) grouped[kat] = [];
            grouped[kat].push(item);
        }

        return {
            unitKerjaId,
            tahun: tahun || new Date().getFullYear(),
            tanggalLaporan: new Date().toISOString().split('T')[0],
            totalArsipTerjaga: results.length,
            dataPerKategori: grouped,
            data: results,
        };
    }
}

export const arsipTerjagaService = new ArsipTerjagaService();
