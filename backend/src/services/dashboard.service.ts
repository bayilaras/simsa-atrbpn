import { db } from '../config/database';
import { suratMasuk } from '../db/schema/surat-masuk';
import { suratKeluar } from '../db/schema/surat-keluar';
import { arsip } from '../db/schema/arsip';
import { unitKerja } from '../db/schema/unit-kerja';
import { sql, eq, and, gte, lte, count, inArray } from 'drizzle-orm';
import { createLogger } from '../utils/logger';

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
        const masukByMonth = new Map(masukMonthlyRaw.map(r => [r.month, r.count]));
        const keluarByMonth = new Map(keluarMonthlyRaw.map(r => [r.month, r.count]));

        const monthlyTrend: MonthlyStats[] = monthNames.map((name, i) => ({
            month: name,
            masuk: masukByMonth.get(i + 1) || 0,
            keluar: keluarByMonth.get(i + 1) || 0,
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
                masuk: masukStatusBreakdown.map(s => ({ status: s.status || 'Unknown', count: s.count })),
                keluar: keluarJenisBreakdown.map(s => ({ status: s.status || 'Unknown', count: s.count })),
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

        return expiringArchives.map(a => ({
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
                targetUnitIds = allTopUnits.map(u => u.id);
            } else {
                const children = await db
                    .select({ id: unitKerja.id, name: unitKerja.name })
                    .from(unitKerja)
                    .where(eq(unitKerja.parentId, unitKerjaId));

                if (children.length > 0) {
                    targetUnitIds = children.map(c => c.id);
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
                        targetUnitIds = siblings.map(s => s.id);
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
            const nameMap = new Map(unitNames.map(u => [u.id, u.name]));
            const masukMap = new Map(masukCounts.map(r => [r.unitId, r.count]));
            const keluarMap = new Map(keluarCounts.map(r => [r.unitId, r.count]));
            const arsipMap = new Map(arsipCounts.map(r => [r.unitId, r.count]));

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
    }
};
