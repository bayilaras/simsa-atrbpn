import { db } from '../config/database';
import { suratMasuk } from '../db/schema/surat-masuk';
import { suratKeluar } from '../db/schema/surat-keluar';
import { arsip } from '../db/schema/arsip';
import { archiveLending } from '../db/schema';
import { eq, and, desc, sql, gte, lte, or, isNull, isNotNull, inArray } from 'drizzle-orm';

// Types
export interface ReportFilters {
    unitKerjaId: string;
    period?: 'daily' | 'weekly' | 'monthly' | 'yearly';
    year?: number;
    month?: number;
    tanggalDari?: string;
    tanggalSampai?: string;
    page?: number;
    limit?: number;
    securityClassifications?: string[] | null;
}

export interface ArsipReportFilters {
    unitKerjaId: string;
    type: 'expiring' | 'permanent' | 'destroyed' | 'all';
    mediaType?: string;
    daysAhead?: number;
    year?: number;
    page?: number;
    limit?: number;
    securityClassifications?: string[] | null;
}

export interface LendingReportFilters {
    unitKerjaId?: string;
    status?: 'borrowed' | 'returned' | 'overdue' | 'all';
    tanggalDari?: string;
    tanggalSampai?: string;
    page?: number;
    limit?: number;
}

class ReportService {
    private incomingClassificationCondition(classes: string[] | null | undefined) {
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

    private arsipClassificationCondition(classes: string[] | null | undefined) {
        if (classes === undefined || classes === null) return undefined;
        if (classes.length === 0) return sql`false`;
        return inArray(
            sql<string>`lower(coalesce(${arsip.klasifikasiKeamanan}, 'biasa'))`,
            classes,
        );
    }

    private outgoingClassificationCondition(classes: string[] | null | undefined) {
        if (classes === undefined || classes === null || classes.includes('terbatas')) return undefined;
        return sql`false`;
    }

    // ==================== SURAT MASUK REPORTS ====================
    async getSuratMasukReport(filters: ReportFilters) {
        const { unitKerjaId, year, tanggalDari, tanggalSampai, page = 1, limit = 50, securityClassifications } = filters;
        const offset = (page - 1) * limit;

        const conditions = [
            eq(suratMasuk.unitKerjaId, unitKerjaId),
            or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted))!,  // Exclude soft-deleted records (NULL-safe)
            this.incomingClassificationCondition(securityClassifications),
        ];

        if (tanggalDari) {
            conditions.push(gte(suratMasuk.tanggalSurat, tanggalDari));
        }
        if (tanggalSampai) {
            conditions.push(lte(suratMasuk.tanggalSurat, tanggalSampai));
        }
        if (year && !tanggalDari && !tanggalSampai) {
            conditions.push(eq(suratMasuk.tahun, year));
        }

        const countResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(suratMasuk)
            .where(and(...conditions));
        const total = countResult?.[0]?.count ?? 0;

        const data = await db
            .select({
                id: suratMasuk.id,
                noUrut: suratMasuk.noUrut,
                nomorSurat: suratMasuk.nomorSurat,
                tanggalSurat: suratMasuk.tanggalSurat,
                dari: suratMasuk.dari,
                kepada: suratMasuk.kepada,
                perihal: suratMasuk.perihal,
                jenisSurat: suratMasuk.jenisSurat,
                sifatSurat: suratMasuk.sifatSurat,
                status: suratMasuk.status,
                isArchived: suratMasuk.isArchived,
                createdAt: suratMasuk.createdAt,
            })
            .from(suratMasuk)
            .where(and(...conditions))
            .orderBy(desc(suratMasuk.tanggalSurat))
            .limit(limit)
            .offset(offset);

        const stats = await this.getSuratMasukStats(unitKerjaId, year, securityClassifications);

        return {
            data,
            stats,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit) || 1,
            },
        };
    }

    async getSuratMasukStats(
        unitKerjaId: string,
        year?: number,
        securityClassifications?: string[] | null,
    ) {
        const currentYear = year || new Date().getFullYear();
        const conditions = [
            eq(suratMasuk.unitKerjaId, unitKerjaId),
            eq(suratMasuk.tahun, currentYear),
            or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted))!,  // Exclude soft-deleted records (NULL-safe)
            this.incomingClassificationCondition(securityClassifications),
        ];

        const stats = await db
            .select({
                total: sql<number>`count(*)::int`,
                belumDibalas: sql<number>`count(*) filter (where ${suratMasuk.status} = 'belum_dibalas')::int`,
                sudahDibalas: sql<number>`count(*) filter (where ${suratMasuk.status} = 'sudah_dibalas')::int`,
                diarsipkan: sql<number>`count(*) filter (where ${suratMasuk.isArchived} = true)::int`,
            })
            .from(suratMasuk)
            .where(and(...conditions));

        const monthlyBreakdown = await db
            .select({
                month: sql<number>`extract(month from ${suratMasuk.tanggalSurat})::int`,
                count: sql<number>`count(*)::int`,
            })
            .from(suratMasuk)
            .where(and(...conditions))
            .groupBy(sql`extract(month from ${suratMasuk.tanggalSurat})`)
            .orderBy(sql`extract(month from ${suratMasuk.tanggalSurat})`);

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const monthlyData = monthNames.map((name, index) => {
            const found = monthlyBreakdown.find(m => m.month === index + 1);
            return { month: name, count: found?.count || 0 };
        });

        return {
            summary: stats[0] || { total: 0, belumDibalas: 0, sudahDibalas: 0, diarsipkan: 0 },
            monthly: monthlyData,
        };
    }

    // ==================== SURAT KELUAR REPORTS ====================
    async getSuratKeluarReport(filters: ReportFilters) {
        const { unitKerjaId, year, tanggalDari, tanggalSampai, page = 1, limit = 50, securityClassifications } = filters;
        const offset = (page - 1) * limit;

        const conditions = [
            eq(suratKeluar.unitKerjaId, unitKerjaId),
            or(eq(suratKeluar.isDeleted, false), isNull(suratKeluar.isDeleted))!,  // Exclude soft-deleted records (NULL-safe)
            this.outgoingClassificationCondition(securityClassifications),
        ];

        if (tanggalDari) {
            conditions.push(gte(suratKeluar.tanggalSurat, tanggalDari));
        }
        if (tanggalSampai) {
            conditions.push(lte(suratKeluar.tanggalSurat, tanggalSampai));
        }
        if (year && !tanggalDari && !tanggalSampai) {
            conditions.push(eq(suratKeluar.tahun, year));
        }

        const countResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(suratKeluar)
            .where(and(...conditions));
        const total = countResult?.[0]?.count ?? 0;

        const data = await db
            .select({
                id: suratKeluar.id,
                noUrut: suratKeluar.noUrut,
                nomorSurat: suratKeluar.nomorSurat,
                tanggalSurat: suratKeluar.tanggalSurat,
                kepada: suratKeluar.kepada,
                perihal: suratKeluar.perihal,
                naskahDinas: suratKeluar.naskahDinas,
                isArchived: suratKeluar.isArchived,
                createdAt: suratKeluar.createdAt,
            })
            .from(suratKeluar)
            .where(and(...conditions))
            .orderBy(desc(suratKeluar.tanggalSurat))
            .limit(limit)
            .offset(offset);

        const stats = await this.getSuratKeluarStats(unitKerjaId, year, securityClassifications);

        return {
            data,
            stats,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit) || 1,
            },
        };
    }

    async getSuratKeluarStats(
        unitKerjaId: string,
        year?: number,
        securityClassifications?: string[] | null,
    ) {
        const currentYear = year || new Date().getFullYear();
        const conditions = [
            eq(suratKeluar.unitKerjaId, unitKerjaId),
            eq(suratKeluar.tahun, currentYear),
            or(eq(suratKeluar.isDeleted, false), isNull(suratKeluar.isDeleted))!,  // Exclude soft-deleted records (NULL-safe)
            this.outgoingClassificationCondition(securityClassifications),
        ];

        const stats = await db
            .select({
                total: sql<number>`count(*)::int`,
                diarsipkan: sql<number>`count(*) filter (where ${suratKeluar.isArchived} = true)::int`,
            })
            .from(suratKeluar)
            .where(and(...conditions));

        const monthlyBreakdown = await db
            .select({
                month: sql<number>`extract(month from ${suratKeluar.tanggalSurat})::int`,
                count: sql<number>`count(*)::int`,
            })
            .from(suratKeluar)
            .where(and(...conditions))
            .groupBy(sql`extract(month from ${suratKeluar.tanggalSurat})`)
            .orderBy(sql`extract(month from ${suratKeluar.tanggalSurat})`);

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const monthlyData = monthNames.map((name, index) => {
            const found = monthlyBreakdown.find(m => m.month === index + 1);
            return { month: name, count: found?.count || 0 };
        });

        return {
            summary: stats[0] || { total: 0, diarsipkan: 0 },
            monthly: monthlyData,
        };
    }

    // ==================== ARSIP REPORTS ====================
    async getArsipReport(filters: ArsipReportFilters) {
        const { unitKerjaId, type = 'all', mediaType, daysAhead = 30, year, page = 1, limit = 50, securityClassifications } = filters;
        const offset = (page - 1) * limit;

        const conditions = [
            eq(arsip.unitKerjaId, unitKerjaId),
            this.arsipClassificationCondition(securityClassifications),
        ];

        const now = new Date();
        const futureDate = new Date();
        futureDate.setDate(now.getDate() + daysAhead);

        if (type === 'expiring') {
            // Archives expiring within daysAhead days
            conditions.push(eq(arsip.legalHold, false));
            conditions.push(isNotNull(arsip.retentionTriggerDate));
            conditions.push(gte(arsip.tanggalKadaluarsa, now.toISOString().split('T')[0]));
            conditions.push(lte(arsip.tanggalKadaluarsa, futureDate.toISOString().split('T')[0]));
        } else if (type === 'permanent') {
            conditions.push(eq(arsip.retensiInaktif, 'Permanen'));
        } else if (type === 'destroyed') {
            conditions.push(eq(arsip.hasilAkhir, 'Musnah'));
        }

        if (mediaType && mediaType !== 'all') {
            conditions.push(eq(arsip.mediaType, mediaType));
        }

        if (year) {
            conditions.push(eq(arsip.tahun, year));
        }

        const countResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(arsip)
            .where(and(...conditions));
        const total = countResult?.[0]?.count ?? 0;

        const data = await db
            .select({
                id: arsip.id,
                kodeKlasifikasi: arsip.kodeKlasifikasi,
                jenisArsip: arsip.jenisArsip,
                mediaType: arsip.mediaType,
                nomorBerkas: arsip.nomorBerkas,
                uraianBerkas: arsip.uraianBerkas,
                tanggalArsip: arsip.tanggalArsip,
                tahun: arsip.tahun,
                retensiAktif: arsip.retensiAktif,
                retensiInaktif: arsip.retensiInaktif,
                tanggalKadaluarsa: arsip.tanggalKadaluarsa,
                retentionTriggerDate: arsip.retentionTriggerDate,
                legalHold: arsip.legalHold,
                hasilAkhir: arsip.hasilAkhir,
                createdAt: arsip.createdAt,
            })
            .from(arsip)
            .where(and(...conditions))
            .orderBy(desc(arsip.createdAt))
            .limit(limit)
            .offset(offset);

        const filteredData = type === 'expiring'
            ? data.filter(item => !item.legalHold && item.retentionTriggerDate)
            : data;

        const stats = await this.getArsipStats(unitKerjaId, year, securityClassifications);

        return {
            data: filteredData,
            stats,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit) || 1,
            },
        };
    }

    async getArsipStats(
        unitKerjaId: string,
        year?: number,
        securityClassifications?: string[] | null,
    ) {
        const conditions = [
            eq(arsip.unitKerjaId, unitKerjaId),
            this.arsipClassificationCondition(securityClassifications),
        ];
        if (year) {
            conditions.push(eq(arsip.tahun, year));
        }

        const now = new Date();
        const next30Days = new Date();
        next30Days.setDate(now.getDate() + 30);

        const stats = await db
            .select({
                total: sql<number>`count(*)::int`,
                masuk: sql<number>`count(*) filter (where ${arsip.jenisArsip} = 'masuk')::int`,
                keluar: sql<number>`count(*) filter (where ${arsip.jenisArsip} = 'keluar')::int`,
                permanen: sql<number>`count(*) filter (where ${arsip.retensiInaktif} = 'Permanen')::int`,
            })
            .from(arsip)
            .where(and(...conditions));

        // By classification type
        const byClassification = await db
            .select({
                kode: arsip.kodeKlasifikasi,
                count: sql<number>`count(*)::int`,
            })
            .from(arsip)
            .where(and(...conditions))
            .groupBy(arsip.kodeKlasifikasi)
            .orderBy(desc(sql`count(*)`))
            .limit(10);

        // By Media Type
        const byMediaType = await db
            .select({
                mediaType: arsip.mediaType,
                count: sql<number>`count(*)::int`,
            })
            .from(arsip)
            .where(and(...conditions))
            .groupBy(arsip.mediaType)
            .orderBy(desc(sql`count(*)`));

        return {
            summary: stats[0] || { total: 0, masuk: 0, keluar: 0, permanen: 0 },
            byClassification,
            byMediaType,
        };
    }

    // ==================== LENDING REPORTS ====================
    // archive_lending has no unit column: an entry belongs to a unit through the
    // arsip it borrows, or through the storage location for per-box lending.
    private lendingUnitCondition(unitKerjaId?: string) {
        if (!unitKerjaId) return undefined;

        return or(
            sql`${archiveLending.arsipId} IN (SELECT id FROM arsip WHERE unit_kerja_id = ${unitKerjaId})`,
            sql`${archiveLending.storageLocationId} IN (SELECT id FROM storage_locations WHERE unit_kerja_id = ${unitKerjaId})`
        );
    }

    async getLendingReport(filters: LendingReportFilters) {
        const { unitKerjaId, status = 'all', tanggalDari, tanggalSampai, page = 1, limit = 50 } = filters;
        const offset = (page - 1) * limit;

        const conditions: any[] = [];

        const unitCondition = this.lendingUnitCondition(unitKerjaId);
        if (unitCondition) {
            conditions.push(unitCondition);
        }
        if (status !== 'all') {
            conditions.push(eq(archiveLending.status, status));
        }
        if (tanggalDari) {
            conditions.push(gte(archiveLending.borrowDate, tanggalDari));
        }
        if (tanggalSampai) {
            conditions.push(lte(archiveLending.borrowDate, tanggalSampai));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const countResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(archiveLending)
            .where(whereClause);
        const total = countResult?.[0]?.count ?? 0;

        const data = await db
            .select({
                id: archiveLending.id,
                lendingType: archiveLending.lendingType,
                borrowerName: archiveLending.borrowerName,
                departmentUnit: archiveLending.departmentUnit,
                borrowDate: archiveLending.borrowDate,
                dueDate: archiveLending.dueDate,
                returnDate: archiveLending.returnDate,
                status: archiveLending.status,
                purpose: archiveLending.purpose,
            })
            .from(archiveLending)
            .where(whereClause)
            .orderBy(desc(archiveLending.borrowDate))
            .limit(limit)
            .offset(offset);

        const stats = await this.getLendingStats(unitKerjaId);

        return {
            data,
            stats,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit) || 1,
            },
        };
    }

    async getLendingStats(unitKerjaId?: string) {
        const now = new Date().toISOString().split('T')[0];
        const unitCondition = this.lendingUnitCondition(unitKerjaId);

        const stats = await db
            .select({
                total: sql<number>`count(*)::int`,
                borrowed: sql<number>`count(*) filter (where ${archiveLending.status} = 'borrowed')::int`,
                returned: sql<number>`count(*) filter (where ${archiveLending.status} = 'returned')::int`,
                overdue: sql<number>`count(*) filter (where ${archiveLending.status} = 'borrowed' and ${archiveLending.dueDate} < ${now})::int`,
            })
            .from(archiveLending)
            .where(unitCondition);

        // Recent lending activity by month
        const currentYear = new Date().getFullYear();
        const monthlyLending = await db
            .select({
                month: sql<number>`extract(month from ${archiveLending.borrowDate})::int`,
                count: sql<number>`count(*)::int`,
            })
            .from(archiveLending)
            .where(and(
                sql`extract(year from ${archiveLending.borrowDate}) = ${currentYear}`,
                unitCondition
            ))
            .groupBy(sql`extract(month from ${archiveLending.borrowDate})`)
            .orderBy(sql`extract(month from ${archiveLending.borrowDate})`);

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const monthlyData = monthNames.map((name, index) => {
            const found = monthlyLending.find(m => m.month === index + 1);
            return { month: name, count: found?.count || 0 };
        });

        return {
            summary: stats[0] || { total: 0, borrowed: 0, returned: 0, overdue: 0 },
            monthly: monthlyData,
        };
    }

    // ==================== SUMMARY REPORTS ====================
    async getSummaryReport(
        unitKerjaId: string,
        year?: number,
        securityClassifications?: string[] | null,
    ) {
        const currentYear = year || new Date().getFullYear();

        const suratMasukStats = await this.getSuratMasukStats(unitKerjaId, currentYear, securityClassifications);
        const suratKeluarStats = await this.getSuratKeluarStats(unitKerjaId, currentYear, securityClassifications);
        const arsipStats = await this.getArsipStats(unitKerjaId, currentYear, securityClassifications);
        const lendingStats = await this.getLendingStats(unitKerjaId);

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        const combinedMonthly = monthNames.map((month, index) => ({
            month,
            masuk: suratMasukStats.monthly[index]?.count || 0,
            keluar: suratKeluarStats.monthly[index]?.count || 0,
        }));

        return {
            year: currentYear,
            suratMasuk: suratMasukStats.summary,
            suratKeluar: suratKeluarStats.summary,
            arsip: arsipStats.summary,
            peminjaman: lendingStats.summary,
            monthlyTrend: combinedMonthly,
        };
    }
}

export const reportService = new ReportService();
