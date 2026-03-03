import { db } from '../config/database.js';
import { suratMasuk } from '../db/schema/surat-masuk.js';
import { suratKeluar } from '../db/schema/surat-keluar.js';
import { arsip } from '../db/schema/arsip.js';
import { unitKerja } from '../db/schema/unit-kerja.js';
import { archiveLending } from '../db/schema/archive-lending.js';
import { storageLocations } from '../db/schema/storage-locations.js';
import { penyusutanArsip } from '../db/schema/penyusutan.js';
import { arsipVital } from '../db/schema/arsip-vital.js';
import { arsipTerjaga } from '../db/schema/arsip-terjaga.js';
import { sql, eq, and, gte, lte, lt, count, inArray, or, isNull } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const log = createLogger('DashboardService');

interface MonthlyStats {
    month: string;
    masuk: number;
    keluar: number;
}

interface DashboardStats {
    totalMasuk: number;
    totalKeluar: number;
    totalArsip: number;
    arsipMasuk: number;
    arsipKeluar: number;
    segmenKadaluarsa: number;
    masukBulanIni: number;
    keluarBulanIni: number;
    monthlyTrend: MonthlyStats[];
    statusBreakdown: {
        masuk: { status: string; count: number }[];
        keluar: { status: string; count: number }[];
    };
}

export const dashboardService = {
    async getStats(unitKerjaId?: string | null, tahun?: number): Promise<DashboardStats> {
        const currentYear = tahun || new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;
        const currentDate = new Date();
        const thirtyDaysFromNow = new Date(currentDate.getTime() + 30 * 24 * 60 * 60 * 1000);

        // Build unit filter fragments for raw SQL
        const unitMasukFilter = unitKerjaId ? sql`AND ${suratMasuk.unitKerjaId} = ${unitKerjaId}` : sql``;
        const unitKeluarFilter = unitKerjaId ? sql`AND ${suratKeluar.unitKerjaId} = ${unitKerjaId}` : sql``;
        const unitArsipFilter = unitKerjaId ? sql`AND ${arsip.unitKerjaId} = ${unitKerjaId}` : sql``;

        // Current month date range
        const startOfMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
        const endOfMonth = new Date(currentYear, currentMonth, 0).toISOString().split('T')[0];
        const yearStart = `${currentYear}-01-01`;
        const yearEnd = `${currentYear}-12-31`;

        // === Run all independent queries in parallel ===
        const [
            [totalMasukResult],
            [totalKeluarResult],
            [totalArsipResult],
            [arsipMasukResult],
            [arsipKeluarResult],
            [expiringResult],
            [masukBulanIniResult],
            [keluarBulanIniResult],
            masukMonthlyRaw,
            keluarMonthlyRaw,
            masukStatusBreakdown,
            keluarJenisBreakdown,
        ] = await Promise.all([
            // Total counts (ALL years)
            db.select({ count: count() }).from(suratMasuk)
                .where(unitKerjaId ? eq(suratMasuk.unitKerjaId, unitKerjaId) : undefined),
            db.select({ count: count() }).from(suratKeluar)
                .where(unitKerjaId ? eq(suratKeluar.unitKerjaId, unitKerjaId) : undefined),
            db.select({ count: count() }).from(arsip)
                .where(unitKerjaId ? eq(arsip.unitKerjaId, unitKerjaId) : undefined),

            // Arsip masuk/keluar breakdown
            db.select({ count: count() }).from(arsip)
                .where(and(eq(arsip.jenisArsip, 'masuk'), ...(unitKerjaId ? [eq(arsip.unitKerjaId, unitKerjaId)] : []))),
            db.select({ count: count() }).from(arsip)
                .where(and(eq(arsip.jenisArsip, 'keluar'), ...(unitKerjaId ? [eq(arsip.unitKerjaId, unitKerjaId)] : []))),

            // Expiring archives (next 30 days)
            db.select({ count: count() }).from(arsip)
                .where(and(
                    gte(arsip.tanggalKadaluarsa, currentDate.toISOString().split('T')[0]),
                    lte(arsip.tanggalKadaluarsa, thirtyDaysFromNow.toISOString().split('T')[0]),
                    ...(unitKerjaId ? [eq(arsip.unitKerjaId, unitKerjaId)] : [])
                )),

            // Current month counts
            db.select({ count: count() }).from(suratMasuk)
                .where(and(
                    gte(suratMasuk.tanggalSurat, startOfMonth),
                    lte(suratMasuk.tanggalSurat, endOfMonth),
                    ...(unitKerjaId ? [eq(suratMasuk.unitKerjaId, unitKerjaId)] : [])
                )),
            db.select({ count: count() }).from(suratKeluar)
                .where(and(
                    gte(suratKeluar.tanggalSurat, startOfMonth),
                    lte(suratKeluar.tanggalSurat, endOfMonth),
                    ...(unitKerjaId ? [eq(suratKeluar.unitKerjaId, unitKerjaId)] : [])
                )),

            // Monthly trend: 1 aggregated query per table instead of 24 sequential queries
            db.select({
                month: sql<number>`EXTRACT(MONTH FROM ${suratMasuk.tanggalSurat})::int`,
                count: count(),
            }).from(suratMasuk)
                .where(and(
                    gte(suratMasuk.tanggalSurat, yearStart),
                    lte(suratMasuk.tanggalSurat, yearEnd),
                    ...(unitKerjaId ? [eq(suratMasuk.unitKerjaId, unitKerjaId)] : [])
                ))
                .groupBy(sql`EXTRACT(MONTH FROM ${suratMasuk.tanggalSurat})`),

            db.select({
                month: sql<number>`EXTRACT(MONTH FROM ${suratKeluar.tanggalSurat})::int`,
                count: count(),
            }).from(suratKeluar)
                .where(and(
                    gte(suratKeluar.tanggalSurat, yearStart),
                    lte(suratKeluar.tanggalSurat, yearEnd),
                    ...(unitKerjaId ? [eq(suratKeluar.unitKerjaId, unitKerjaId)] : [])
                ))
                .groupBy(sql`EXTRACT(MONTH FROM ${suratKeluar.tanggalSurat})`),

            // Status breakdowns (year-filtered)
            db.select({ status: suratMasuk.status, count: count() })
                .from(suratMasuk)
                .where(and(eq(suratMasuk.tahun, currentYear), ...(unitKerjaId ? [eq(suratMasuk.unitKerjaId, unitKerjaId)] : [])))
                .groupBy(suratMasuk.status),

            db.select({ status: suratKeluar.naskahDinas, count: count() })
                .from(suratKeluar)
                .where(and(eq(suratKeluar.tahun, currentYear), ...(unitKerjaId ? [eq(suratKeluar.unitKerjaId, unitKerjaId)] : [])))
                .groupBy(suratKeluar.naskahDinas),
        ]);

        // Build monthly trend from aggregated results (O(12) map instead of 24 queries)
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
        const masukByMonth = new Map(masukMonthlyRaw.map((r: any) => [r.month, r.count]));
        const keluarByMonth = new Map(keluarMonthlyRaw.map((r: any) => [r.month, r.count]));

        const monthlyTrend: MonthlyStats[] = monthNames.map((name, i) => ({
            month: name,
            masuk: (masukByMonth.get(i + 1) || 0) as number,
            keluar: (keluarByMonth.get(i + 1) || 0) as number,
        }));

        return {
            totalMasuk: totalMasukResult?.count || 0,
            totalKeluar: totalKeluarResult?.count || 0,
            totalArsip: totalArsipResult?.count || 0,
            arsipMasuk: arsipMasukResult?.count || 0,
            arsipKeluar: arsipKeluarResult?.count || 0,
            segmenKadaluarsa: expiringResult?.count || 0,
            masukBulanIni: masukBulanIniResult?.count || 0,
            keluarBulanIni: keluarBulanIniResult?.count || 0,
            monthlyTrend,
            statusBreakdown: {
                masuk: masukStatusBreakdown.map((s: any) => ({ status: s.status || 'Unknown', count: s.count })),
                keluar: keluarJenisBreakdown.map((s: any) => ({ status: s.status || 'Unknown', count: s.count })),
            },
        };
    },

    async getRecentActivity(unitKerjaId?: string | null, limit: number = 10) {
        // Get recent surat masuk
        const recentMasuk = await db
            .select({
                id: suratMasuk.id,
                type: sql<string>`'masuk'`,
                nomorSurat: suratMasuk.nomorSurat,
                perihal: suratMasuk.perihal,
                tanggal: suratMasuk.tanggalSurat,
                createdAt: suratMasuk.createdAt,
            })
            .from(suratMasuk)
            .where(unitKerjaId ? eq(suratMasuk.unitKerjaId, unitKerjaId) : undefined)
            .orderBy(sql`${suratMasuk.createdAt} DESC`)
            .limit(limit);

        // Get recent surat keluar
        const recentKeluar = await db
            .select({
                id: suratKeluar.id,
                type: sql<string>`'keluar'`,
                nomorSurat: suratKeluar.nomorSurat,
                perihal: suratKeluar.perihal,
                tanggal: suratKeluar.tanggalSurat,
                createdAt: suratKeluar.createdAt,
            })
            .from(suratKeluar)
            .where(unitKerjaId ? eq(suratKeluar.unitKerjaId, unitKerjaId) : undefined)
            .orderBy(sql`${suratKeluar.createdAt} DESC`)
            .limit(limit);

        // Combine and sort by createdAt
        const combined = [...recentMasuk, ...recentKeluar]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, limit);

        return combined;
    },

    async getExpiringArchives(unitKerjaId?: string | null, daysAhead: number = 30) {
        const currentDate = new Date();
        const futureDate = new Date(currentDate.getTime() + daysAhead * 24 * 60 * 60 * 1000);

        const expiringArchives = await db
            .select({
                id: arsip.id,
                uraianBerkas: arsip.uraianBerkas,
                kodeKlasifikasi: arsip.kodeKlasifikasi,
                tanggalKadaluarsa: arsip.tanggalKadaluarsa,
            })
            .from(arsip)
            .where(and(
                ...(unitKerjaId ? [eq(arsip.unitKerjaId, unitKerjaId)] : []),
                gte(arsip.tanggalKadaluarsa, currentDate.toISOString().split('T')[0]),
                lte(arsip.tanggalKadaluarsa, futureDate.toISOString().split('T')[0])
            ))
            .orderBy(arsip.tanggalKadaluarsa)
            .limit(10);

        return expiringArchives.map((a: any) => ({
            ...a,
            daysLeft: Math.ceil(
                (new Date(a.tanggalKadaluarsa as string).getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24)
            ),
        }));
    },

    async getUnitKerjaComparison(unitKerjaId?: string | null, tahun?: number) {
        try {
            const currentYear = tahun || new Date().getFullYear();

            // 1. Determine which units to compare
            let targetUnitIds: string[] = [];

            if (!unitKerjaId) {
                const allTopUnits = await db
                    .select({ id: unitKerja.id, name: unitKerja.name })
                    .from(unitKerja)
                    .where(sql`${unitKerja.parentId} IS NULL`);
                targetUnitIds = allTopUnits.map((u: any) => u.id);
            } else {
                const children = await db
                    .select({ id: unitKerja.id, name: unitKerja.name })
                    .from(unitKerja)
                    .where(eq(unitKerja.parentId, unitKerjaId));

                if (children.length > 0) {
                    targetUnitIds = children.map((c: any) => c.id);
                } else {
                    const currentUnit = await db
                        .select({ parentId: unitKerja.parentId })
                        .from(unitKerja)
                        .where(eq(unitKerja.id, unitKerjaId));

                    const parentId = currentUnit[0]?.parentId;

                    if (parentId) {
                        const siblings = await db
                            .select({ id: unitKerja.id, name: unitKerja.name })
                            .from(unitKerja)
                            .where(eq(unitKerja.parentId, parentId));
                        targetUnitIds = siblings.map((s: any) => s.id);
                    } else {
                        targetUnitIds = [unitKerjaId];
                    }
                }

                if (!targetUnitIds.includes(unitKerjaId)) {
                    targetUnitIds.push(unitKerjaId);
                }
            }

            if (targetUnitIds.length === 0) return [];

            // 2. Fetch all data in parallel with aggregated queries instead of N+1 loop
            const [unitNames, masukCounts, keluarCounts, arsipCounts] = await Promise.all([
                db.select({ id: unitKerja.id, name: unitKerja.name })
                    .from(unitKerja)
                    .where(inArray(unitKerja.id, targetUnitIds)),

                db.select({ unitId: suratMasuk.unitKerjaId, count: count() })
                    .from(suratMasuk)
                    .where(and(
                        inArray(suratMasuk.unitKerjaId, targetUnitIds),
                        eq(suratMasuk.tahun, currentYear)
                    ))
                    .groupBy(suratMasuk.unitKerjaId),

                db.select({ unitId: suratKeluar.unitKerjaId, count: count() })
                    .from(suratKeluar)
                    .where(and(
                        inArray(suratKeluar.unitKerjaId, targetUnitIds),
                        eq(suratKeluar.tahun, currentYear)
                    ))
                    .groupBy(suratKeluar.unitKerjaId),

                db.select({ unitId: arsip.unitKerjaId, count: count() })
                    .from(arsip)
                    .where(and(
                        inArray(arsip.unitKerjaId, targetUnitIds),
                        eq(arsip.tahun, currentYear)
                    ))
                    .groupBy(arsip.unitKerjaId),
            ]);

            // 3. Build result from maps
            const nameMap = new Map(unitNames.map((u: any) => [u.id, u.name]));
            const masukMap = new Map<string, number>(masukCounts.map((r: any) => [r.unitId, r.count]));
            const keluarMap = new Map<string, number>(keluarCounts.map((r: any) => [r.unitId, r.count]));
            const arsipMap = new Map<string, number>(arsipCounts.map((r: any) => [r.unitId, r.count]));

            const comparisonData = targetUnitIds.map(unitId => ({
                name: nameMap.get(unitId) || unitId,
                masuk: masukMap.get(unitId) || 0,
                keluar: keluarMap.get(unitId) || 0,
                arsip: arsipMap.get(unitId) || 0,
            }));

            return comparisonData.sort((a, b) => b.masuk - a.masuk);
        } catch (error) {
            log.error({ err: error }, '[DashboardService] Error in getUnitKerjaComparison:');
            throw error;
        }
    },

    async getWidgetData(unitKerjaId?: string | null) {
        try {
            const today = new Date().toISOString().split('T')[0];
            const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            // Build unit kerja filter conditions for each table
            const arsipUnitFilter = unitKerjaId ? [eq(arsip.unitKerjaId, unitKerjaId)] : [];
            const storageUnitFilter = unitKerjaId ? [eq(storageLocations.unitKerjaId, unitKerjaId)] : [];
            const penyusutanUnitFilter = unitKerjaId ? [eq(penyusutanArsip.unitKerjaId, unitKerjaId)] : [];
            const vitalUnitFilter = unitKerjaId ? [eq(arsipVital.unitKerjaId, unitKerjaId)] : [];
            const terjagaUnitFilter = unitKerjaId ? [eq(arsipTerjaga.unitKerjaId, unitKerjaId)] : [];

            const [
                // Archive Lifecycle — compute status from retention dates using SQL
                arsipAktifResult,
                arsipInaktifResult,
                arsipKadaluarsaResult,
                arsipTotalResult,
                // Storage Capacity
                storageData,
                // Lending Overview
                lendingBorrowedResult,
                lendingOverdueResult,
                // Penyusutan Overview
                penyusutanStatusData,
                // Vital/Terjaga Alerts
                vitalUnprotectedResult,
                terjagaUnreportedResult,
                vitalTotalResult,
                terjagaTotalResult,
                // Media Breakdown
                mediaData,
            ] = await Promise.all([
                // 1. Arsip Aktif: has retensi_aktif set AND aktif period hasn't ended yet
                db.select({ count: count() }).from(arsip)
                    .where(and(
                        ...arsipUnitFilter,
                        sql`${arsip.tanggalArsip} IS NOT NULL`,
                        sql`${arsip.retensiAktif} IS NOT NULL`,
                        sql`(${arsip.tanggalArsip}::date + (COALESCE(NULLIF(regexp_replace(${arsip.retensiAktif}, '[^0-9]', '', 'g'), ''), '0')::int * INTERVAL '1 year')) > ${today}::date`,
                    )),

                // 2. Arsip Inaktif: aktif period ended, but inaktif period hasn't ended yet
                db.select({ count: count() }).from(arsip)
                    .where(and(
                        ...arsipUnitFilter,
                        sql`${arsip.tanggalArsip} IS NOT NULL`,
                        sql`${arsip.retensiAktif} IS NOT NULL`,
                        sql`(${arsip.tanggalArsip}::date + (COALESCE(NULLIF(regexp_replace(${arsip.retensiAktif}, '[^0-9]', '', 'g'), ''), '0')::int * INTERVAL '1 year')) <= ${today}::date`,
                        sql`(${arsip.tanggalArsip}::date + ((COALESCE(NULLIF(regexp_replace(${arsip.retensiAktif}, '[^0-9]', '', 'g'), ''), '0')::int + COALESCE(NULLIF(regexp_replace(COALESCE(${arsip.retensiInaktif}, '0'), '[^0-9]', '', 'g'), ''), '0')::int) * INTERVAL '1 year')) > ${today}::date`,
                    )),

                // 3. Arsip Kadaluarsa: both aktif + inaktif periods ended
                db.select({ count: count() }).from(arsip)
                    .where(and(
                        ...arsipUnitFilter,
                        sql`${arsip.tanggalArsip} IS NOT NULL`,
                        sql`${arsip.retensiAktif} IS NOT NULL`,
                        sql`(${arsip.tanggalArsip}::date + ((COALESCE(NULLIF(regexp_replace(${arsip.retensiAktif}, '[^0-9]', '', 'g'), ''), '0')::int + COALESCE(NULLIF(regexp_replace(COALESCE(${arsip.retensiInaktif}, '0'), '[^0-9]', '', 'g'), ''), '0')::int) * INTERVAL '1 year')) <= ${today}::date`,
                    )),

                // 4. Total arsip (for "no retensi" count calculation)
                db.select({ count: count() }).from(arsip)
                    .where(and(...arsipUnitFilter)),

                // 5. Storage Capacity — top-level locations (gedung) with aggregate capacity
                db.select({
                    id: storageLocations.id,
                    name: storageLocations.name,
                    code: storageLocations.code,
                    level: storageLocations.level,
                    capacity: storageLocations.capacity,
                    currentCount: storageLocations.currentCount,
                }).from(storageLocations)
                    .where(and(
                        ...storageUnitFilter,
                        eq(storageLocations.level, 'gedung'),
                    ))
                    .orderBy(storageLocations.code)
                    .limit(10),

                // 6. Lending — active borrowed
                db.select({ count: count() }).from(archiveLending)
                    .where(and(
                        eq(archiveLending.status, 'borrowed'),
                        ...(unitKerjaId ? [
                            sql`${archiveLending.arsipId} IN (SELECT id FROM arsip WHERE unit_kerja_id = ${unitKerjaId})`
                        ] : []),
                    )),

                // 7. Lending — overdue
                db.select({ count: count() }).from(archiveLending)
                    .where(and(
                        eq(archiveLending.status, 'borrowed'),
                        lt(archiveLending.dueDate, today),
                        ...(unitKerjaId ? [
                            sql`${archiveLending.arsipId} IN (SELECT id FROM arsip WHERE unit_kerja_id = ${unitKerjaId})`
                        ] : []),
                    )),

                // 8. Penyusutan — count per status
                db.select({
                    status: penyusutanArsip.status,
                    count: count(),
                }).from(penyusutanArsip)
                    .where(and(...penyusutanUnitFilter))
                    .groupBy(penyusutanArsip.status),

                // 9. Vital — unprotected
                db.select({ count: count() }).from(arsipVital)
                    .where(and(
                        ...vitalUnitFilter,
                        eq(arsipVital.statusProteksi, 'belum_diproteksi'),
                    )),

                // 10. Terjaga — unreported
                db.select({ count: count() }).from(arsipTerjaga)
                    .where(and(
                        ...terjagaUnitFilter,
                        eq(arsipTerjaga.statusPelaporan, 'belum_dilaporkan'),
                    )),

                // 11. Vital — total
                db.select({ count: count() }).from(arsipVital)
                    .where(and(...vitalUnitFilter)),

                // 12. Terjaga — total
                db.select({ count: count() }).from(arsipTerjaga)
                    .where(and(...terjagaUnitFilter)),

                // 13. Media breakdown
                db.select({
                    mediaType: arsip.mediaType,
                    count: count(),
                }).from(arsip)
                    .where(and(...arsipUnitFilter))
                    .groupBy(arsip.mediaType),
            ]);

            // Compute storage capacity aggregates per gedung — single query instead of N+1 loop
            let storageCapacity: any[] = [];
            if (storageData.length > 0) {
                const gedungCodes = storageData.map((loc: any) => loc.code);
                // Build OR conditions for each gedung code prefix
                const prefixConditions = gedungCodes.map((code: string) =>
                    sql`${storageLocations.code} LIKE ${code + '%'}`
                );
                const allBoxStats = await db.select({
                    prefix: sql<string>`LEFT(${storageLocations.code}, 2)`,
                    totalCapacity: sql<number>`COALESCE(SUM(${storageLocations.capacity}), 0)::int`,
                    totalCount: sql<number>`COALESCE(SUM(${storageLocations.currentCount}), 0)::int`,
                    boxCount: count(),
                }).from(storageLocations)
                    .where(and(
                        ...(unitKerjaId ? [eq(storageLocations.unitKerjaId, unitKerjaId)] : []),
                        eq(storageLocations.level, 'box'),
                        or(...prefixConditions),
                    ))
                    .groupBy(sql`LEFT(${storageLocations.code}, 2)`);

                const boxStatsMap = new Map(allBoxStats.map((s: any) => [s.prefix, s]));

                storageCapacity = storageData.map((loc: any) => {
                    const prefix = loc.code?.substring(0, 2) || '';
                    const stats = boxStatsMap.get(prefix);
                    return {
                        id: loc.id,
                        name: loc.name,
                        code: loc.code,
                        totalCapacity: stats?.totalCapacity || 0,
                        currentCount: stats?.totalCount || 0,
                        boxCount: stats?.boxCount || 0,
                        usagePercent: stats?.totalCapacity
                            ? Math.round((stats.totalCount / stats.totalCapacity) * 100)
                            : 0,
                    };
                });
            }

            // Build penyusutan overview object
            const penyusutanStatuses = ['draft', 'proposed', 'reviewed', 'approved', 'executed'];
            const penyusutanMap = new Map(penyusutanStatusData.map((s: any) => [s.status, s.count]));
            const penyusutanOverview = penyusutanStatuses.map(status => ({
                status,
                count: penyusutanMap.get(status) || 0,
            }));

            // Calculate counts
            const aktifCount = arsipAktifResult[0]?.count || 0;
            const inaktifCount = arsipInaktifResult[0]?.count || 0;
            const kadaluarsaCount = arsipKadaluarsaResult[0]?.count || 0;
            const totalArsip = arsipTotalResult[0]?.count || 0;
            const belumDitentukan = Math.max(0, totalArsip - aktifCount - inaktifCount - kadaluarsaCount);

            return {
                archiveLifecycle: {
                    aktif: aktifCount,
                    inaktif: inaktifCount,
                    kadaluarsa: kadaluarsaCount,
                    belumDitentukan,
                    total: totalArsip,
                },
                storageCapacity,
                lendingOverview: {
                    borrowed: lendingBorrowedResult[0]?.count || 0,
                    overdue: lendingOverdueResult[0]?.count || 0,
                },
                penyusutanOverview,
                vitalTerjagaAlerts: {
                    vitalUnprotected: vitalUnprotectedResult[0]?.count || 0,
                    vitalTotal: vitalTotalResult[0]?.count || 0,
                    terjagaUnreported: terjagaUnreportedResult[0]?.count || 0,
                    terjagaTotal: terjagaTotalResult[0]?.count || 0,
                },
                mediaBreakdown: mediaData.map((m: any) => ({
                    type: m.mediaType || 'Lainnya',
                    count: m.count,
                })),
            };
        } catch (error) {
            log.error({ err: error }, '[DashboardService] Error in getWidgetData:');
            throw error;
        }
    },
};
