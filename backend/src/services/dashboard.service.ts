import { db } from '../config/database.js';
import { suratMasuk } from '../db/schema/surat-masuk.js';
import { suratKeluar } from '../db/schema/surat-keluar.js';
import { arsip } from '../db/schema/arsip.js';
import { arsipRuleSnapshots } from '../db/schema/arsip-rule-snapshots.js';
import {
    jraAppraisalCases,
    jraAppraisalDecisions,
    retentionTriggerEvents,
    retentionTriggerVerifications,
} from '../db/schema/index.js';
import { unitKerja } from '../db/schema/unit-kerja.js';
import { archiveLending } from '../db/schema/archive-lending.js';
import { storageLocations } from '../db/schema/storage-locations.js';
import { penyusutanArsip, penyusutanItems } from '../db/schema/penyusutan.js';
import { arsipVital } from '../db/schema/arsip-vital.js';
import { arsipTerjaga } from '../db/schema/arsip-terjaga.js';
import { sql, eq, and, gte, lte, lt, count, inArray, or } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import { arsipService } from './arsip.service.js';
import {
    CURRENT_APPRAISAL_CASE_JOIN,
    CURRENT_APPRAISAL_DECISION_JOIN,
    CURRENT_RETENTION_TRIGGER_JOIN,
    CURRENT_RETENTION_VERIFICATION_JOIN,
    RETENTION_GOVERNANCE_EVIDENCE_SELECT,
} from './archive-rule-assignment.service.js';

const log = createLogger('DashboardService');

function arsipClassificationCondition(classes: string[] | null | undefined) {
    if (classes === undefined || classes === null) return undefined;
    if (classes.length === 0) return sql`false`;
    return inArray(
        sql<string>`lower(coalesce(${arsip.klasifikasiKeamanan}, 'biasa'))`,
        classes,
    );
}

function incomingClassificationCondition(classes: string[] | null | undefined) {
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

function outgoingClassificationCondition(classes: string[] | null | undefined) {
    if (classes === undefined || classes === null) return undefined;
    // The legacy table has no security column, so every outgoing record is
    // treated as Terbatas until it is classified in the controlled archive.
    return classes.includes('terbatas') ? undefined : sql`false`;
}

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
    async getStats(
        unitKerjaId?: string | null,
        tahun?: number,
        securityClassifications?: string[] | null,
    ): Promise<DashboardStats> {
        const currentYear = tahun || new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;
        const incomingClass = incomingClassificationCondition(securityClassifications);
        const outgoingClass = outgoingClassificationCondition(securityClassifications);
        const archiveClass = arsipClassificationCondition(securityClassifications);

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
            expiringArchives,
            [masukBulanIniResult],
            [keluarBulanIniResult],
            masukMonthlyRaw,
            keluarMonthlyRaw,
            masukStatusBreakdown,
            keluarJenisBreakdown,
        ] = await Promise.all([
            // Total counts (ALL years)
            db.select({ count: count() }).from(suratMasuk)
                .where(and(
                    unitKerjaId ? eq(suratMasuk.unitKerjaId, unitKerjaId) : undefined,
                    incomingClass,
                )),
            db.select({ count: count() }).from(suratKeluar)
                .where(and(
                    unitKerjaId ? eq(suratKeluar.unitKerjaId, unitKerjaId) : undefined,
                    outgoingClass,
                )),
            db.select({ count: count() }).from(arsip)
                .where(and(
                    unitKerjaId ? eq(arsip.unitKerjaId, unitKerjaId) : undefined,
                    archiveClass,
                )),

            // Arsip masuk/keluar breakdown
            db.select({ count: count() }).from(arsip)
                .where(and(
                    eq(arsip.jenisArsip, 'masuk'),
                    unitKerjaId ? eq(arsip.unitKerjaId, unitKerjaId) : undefined,
                    archiveClass,
                )),
            db.select({ count: count() }).from(arsip)
                .where(and(
                    eq(arsip.jenisArsip, 'keluar'),
                    unitKerjaId ? eq(arsip.unitKerjaId, unitKerjaId) : undefined,
                    archiveClass,
                )),

            // Expiring archives (next 30 days), verified from canonical snapshots.
            arsipService.getExpiring(unitKerjaId, 30, securityClassifications),

            // Current month counts
            db.select({ count: count() }).from(suratMasuk)
                .where(and(
                    gte(suratMasuk.tanggalSurat, startOfMonth),
                    lte(suratMasuk.tanggalSurat, endOfMonth),
                    unitKerjaId ? eq(suratMasuk.unitKerjaId, unitKerjaId) : undefined,
                    incomingClass,
                )),
            db.select({ count: count() }).from(suratKeluar)
                .where(and(
                    gte(suratKeluar.tanggalSurat, startOfMonth),
                    lte(suratKeluar.tanggalSurat, endOfMonth),
                    unitKerjaId ? eq(suratKeluar.unitKerjaId, unitKerjaId) : undefined,
                    outgoingClass,
                )),

            // Monthly trend: 1 aggregated query per table instead of 24 sequential queries
            db.select({
                month: sql<number>`EXTRACT(MONTH FROM ${suratMasuk.tanggalSurat})::int`,
                count: count(),
            }).from(suratMasuk)
                .where(and(
                    gte(suratMasuk.tanggalSurat, yearStart),
                    lte(suratMasuk.tanggalSurat, yearEnd),
                    unitKerjaId ? eq(suratMasuk.unitKerjaId, unitKerjaId) : undefined,
                    incomingClass,
                ))
                .groupBy(sql`EXTRACT(MONTH FROM ${suratMasuk.tanggalSurat})`),

            db.select({
                month: sql<number>`EXTRACT(MONTH FROM ${suratKeluar.tanggalSurat})::int`,
                count: count(),
            }).from(suratKeluar)
                .where(and(
                    gte(suratKeluar.tanggalSurat, yearStart),
                    lte(suratKeluar.tanggalSurat, yearEnd),
                    unitKerjaId ? eq(suratKeluar.unitKerjaId, unitKerjaId) : undefined,
                    outgoingClass,
                ))
                .groupBy(sql`EXTRACT(MONTH FROM ${suratKeluar.tanggalSurat})`),

            // Status breakdowns (year-filtered)
            db.select({ status: suratMasuk.status, count: count() })
                .from(suratMasuk)
                .where(and(
                    eq(suratMasuk.tahun, currentYear),
                    unitKerjaId ? eq(suratMasuk.unitKerjaId, unitKerjaId) : undefined,
                    incomingClass,
                ))
                .groupBy(suratMasuk.status),

            db.select({ status: suratKeluar.naskahDinas, count: count() })
                .from(suratKeluar)
                .where(and(
                    eq(suratKeluar.tahun, currentYear),
                    unitKerjaId ? eq(suratKeluar.unitKerjaId, unitKerjaId) : undefined,
                    outgoingClass,
                ))
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
            segmenKadaluarsa: expiringArchives.length,
            masukBulanIni: masukBulanIniResult?.count || 0,
            keluarBulanIni: keluarBulanIniResult?.count || 0,
            monthlyTrend,
            statusBreakdown: {
                masuk: masukStatusBreakdown.map((s: any) => ({ status: s.status || 'Unknown', count: s.count })),
                keluar: keluarJenisBreakdown.map((s: any) => ({ status: s.status || 'Unknown', count: s.count })),
            },
        };
    },

    async getRecentActivity(
        unitKerjaId?: string | null,
        limit: number = 10,
        securityClassifications?: string[] | null,
    ) {
        const incomingClass = incomingClassificationCondition(securityClassifications);
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
            .where(and(
                unitKerjaId ? eq(suratMasuk.unitKerjaId, unitKerjaId) : undefined,
                incomingClass,
            ))
            .orderBy(sql`${suratMasuk.createdAt} DESC`)
            .limit(limit);

        // Get recent surat keluar
        const recentKeluar = securityClassifications === undefined
            || securityClassifications === null
            || securityClassifications.includes('terbatas')
            ? await db
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
            .limit(limit)
            : [];

        // Combine and sort by createdAt
        const combined = [...recentMasuk, ...recentKeluar]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, limit);

        return combined;
    },

    async getExpiringArchives(
        unitKerjaId?: string | null,
        daysAhead: number = 30,
        securityClassifications?: string[] | null,
    ) {
        const currentDate = new Date();
        const expiringArchives = await arsipService.getExpiring(
            unitKerjaId,
            daysAhead,
            securityClassifications,
        );

        return expiringArchives
            .slice(0, 10)
            .map((a: any) => ({
            ...a,
            daysLeft: Math.ceil(
                (new Date(a.tanggalKadaluarsa as string).getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24)
            ),
        }));
    },

    async getUnitKerjaComparison(
        unitKerjaId?: string | null,
        tahun?: number,
        securityClassifications?: string[] | null,
        allowRelatedUnits = false,
    ) {
        try {
            const currentYear = tahun || new Date().getFullYear();
            const incomingClass = incomingClassificationCondition(securityClassifications);
            const outgoingClass = outgoingClassificationCondition(securityClassifications);
            const archiveClass = arsipClassificationCondition(securityClassifications);

            // 1. Determine which units to compare
            let targetUnitIds: string[] = [];

            if (!allowRelatedUnits) {
                // A scoped user may only see their own unit, never sibling or
                // child-unit aggregates that could reveal protected activity.
                if (!unitKerjaId) return [];
                targetUnitIds = [unitKerjaId];
            } else if (!unitKerjaId) {
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
                        eq(suratMasuk.tahun, currentYear),
                        incomingClass,
                    ))
                    .groupBy(suratMasuk.unitKerjaId),

                db.select({ unitId: suratKeluar.unitKerjaId, count: count() })
                    .from(suratKeluar)
                    .where(and(
                        inArray(suratKeluar.unitKerjaId, targetUnitIds),
                        eq(suratKeluar.tahun, currentYear),
                        outgoingClass,
                    ))
                    .groupBy(suratKeluar.unitKerjaId),

                db.select({ unitId: arsip.unitKerjaId, count: count() })
                    .from(arsip)
                    .where(and(
                        inArray(arsip.unitKerjaId, targetUnitIds),
                        eq(arsip.tahun, currentYear),
                        archiveClass,
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

    async getWidgetData(
        unitKerjaId?: string | null,
        securityClassifications?: string[] | null,
    ) {
        try {
            const today = new Date().toISOString().split('T')[0];
            const archiveClass = arsipClassificationCondition(securityClassifications);

            // Build unit kerja filter conditions for each table
            const arsipUnitFilter = unitKerjaId ? [eq(arsip.unitKerjaId, unitKerjaId)] : [];
            const storageUnitFilter = unitKerjaId ? [eq(storageLocations.unitKerjaId, unitKerjaId)] : [];
            const penyusutanUnitFilter = unitKerjaId ? [eq(penyusutanArsip.unitKerjaId, unitKerjaId)] : [];
            const vitalUnitFilter = unitKerjaId ? [eq(arsipVital.unitKerjaId, unitKerjaId)] : [];
            const terjagaUnitFilter = unitKerjaId ? [eq(arsipTerjaga.unitKerjaId, unitKerjaId)] : [];

            const [
                // Archive Lifecycle — evaluated from an explicit retention trigger
                arsipLifecycleData,
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
                // 1. Fetch only the fields required for a single, shared lifecycle
                // evaluation. Held and missing-trigger records are never classified as
                // active/inactive/expired.
                db.select({
                    id: arsip.id,
                    retentionTriggerDate: arsip.retentionTriggerDate,
                    legalHold: arsip.legalHold,
                    ruleProvenanceStatus: arsip.ruleProvenanceStatus,
                    currentRuleSnapshotId: arsip.currentRuleSnapshotId,
                    currentRetentionTriggerEventId: arsip.currentRetentionTriggerEventId,
                    currentAppraisalDecisionId: arsip.currentAppraisalDecisionId,
                    jraItemId: arsip.jraItemId,
                    jraRuleSetId: arsip.jraRuleSetId,
                    retentionDecisionHash: arsip.retentionDecisionHash,
                    ruleSnapshotId: arsipRuleSnapshots.id,
                    ruleSnapshotArsipId: arsipRuleSnapshots.arsipId,
                    ruleSnapshotStatus: arsipRuleSnapshots.status,
                    ruleSnapshotJraItemId: arsipRuleSnapshots.jraItemId,
                    ruleSnapshotJraRuleSetId: arsipRuleSnapshots.jraRuleSetId,
                    ruleSnapshot: arsipRuleSnapshots.snapshot,
                    ruleSnapshotSha256: arsipRuleSnapshots.snapshotSha256,
                    ...RETENTION_GOVERNANCE_EVIDENCE_SELECT,
                }).from(arsip)
                    .leftJoin(arsipRuleSnapshots, and(
                        eq(arsipRuleSnapshots.id, arsip.currentRuleSnapshotId),
                        eq(arsipRuleSnapshots.arsipId, arsip.id),
                    ))
                    .leftJoin(retentionTriggerEvents, CURRENT_RETENTION_TRIGGER_JOIN)
                    .leftJoin(retentionTriggerVerifications, CURRENT_RETENTION_VERIFICATION_JOIN)
                    .leftJoin(jraAppraisalDecisions, CURRENT_APPRAISAL_DECISION_JOIN)
                    .leftJoin(jraAppraisalCases, CURRENT_APPRAISAL_CASE_JOIN)
                    .where(and(...arsipUnitFilter, archiveClass)),

                // 2. Storage Capacity — top-level locations (gedung) with aggregate capacity
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

                // 3. Lending — active borrowed
                db.select({ count: count() }).from(archiveLending)
                    .innerJoin(arsip, eq(archiveLending.arsipId, arsip.id))
                    .where(and(
                        eq(archiveLending.status, 'borrowed'),
                        unitKerjaId ? eq(arsip.unitKerjaId, unitKerjaId) : undefined,
                        archiveClass,
                    )),

                // 4. Lending — overdue
                db.select({ count: count() }).from(archiveLending)
                    .innerJoin(arsip, eq(archiveLending.arsipId, arsip.id))
                    .where(and(
                        eq(archiveLending.status, 'borrowed'),
                        lt(archiveLending.dueDate, today),
                        unitKerjaId ? eq(arsip.unitKerjaId, unitKerjaId) : undefined,
                        archiveClass,
                    )),

                // 5. Penyusutan — count per status
                db.select({
                    status: penyusutanArsip.status,
                    count: sql<number>`count(distinct ${penyusutanArsip.id})::int`,
                }).from(penyusutanArsip)
                    .innerJoin(penyusutanItems, eq(penyusutanItems.penyusutanId, penyusutanArsip.id))
                    .innerJoin(arsip, eq(penyusutanItems.arsipId, arsip.id))
                    .where(and(...penyusutanUnitFilter, archiveClass))
                    .groupBy(penyusutanArsip.status),

                // 6. Vital — unprotected
                db.select({ count: count() }).from(arsipVital)
                    .innerJoin(arsip, eq(arsipVital.arsipId, arsip.id))
                    .where(and(
                        ...vitalUnitFilter,
                        eq(arsipVital.statusProteksi, 'belum_diproteksi'),
                        archiveClass,
                    )),

                // 7. Terjaga — unreported
                db.select({ count: count() }).from(arsipTerjaga)
                    .innerJoin(arsip, eq(arsipTerjaga.arsipId, arsip.id))
                    .where(and(
                        ...terjagaUnitFilter,
                        eq(arsipTerjaga.statusPelaporan, 'belum_dilaporkan'),
                        archiveClass,
                    )),

                // 8. Vital — total
                db.select({ count: count() }).from(arsipVital)
                    .innerJoin(arsip, eq(arsipVital.arsipId, arsip.id))
                    .where(and(...vitalUnitFilter, archiveClass)),

                // 9. Terjaga — total
                db.select({ count: count() }).from(arsipTerjaga)
                    .innerJoin(arsip, eq(arsipTerjaga.arsipId, arsip.id))
                    .where(and(...terjagaUnitFilter, archiveClass)),

                // 10. Media breakdown
                db.select({
                    mediaType: arsip.mediaType,
                    count: count(),
                }).from(arsip)
                    .where(and(...arsipUnitFilter, archiveClass))
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

            // Calculate lifecycle counts through the same trigger-aware logic used by
            // retention candidates and penyusutan workflows.
            let aktifCount = 0;
            let inaktifCount = 0;
            let kadaluarsaCount = 0;
            let belumDitentukan = 0;
            let heldCount = 0;
            let missingTriggerCount = 0;
            let manualReviewCount = 0;
            let unverifiedRulesCount = 0;

            for (const archive of arsipLifecycleData) {
                if (archive.legalHold) {
                    heldCount += 1;
                    continue;
                }
                if (!archive.currentRetentionTriggerEventId) {
                    missingTriggerCount += 1;
                    continue;
                }

                if (archive.ruleProvenanceStatus !== 'verified') {
                    unverifiedRulesCount += 1;
                    belumDitentukan += 1;
                    continue;
                }

                const evaluation = arsipService.evaluateCanonicalRetention(archive);
                if (!evaluation.verified) {
                    unverifiedRulesCount += 1;
                    belumDitentukan += 1;
                    continue;
                }
                if (!evaluation.calculationEligible) {
                    manualReviewCount += 1;
                    belumDitentukan += 1;
                    continue;
                }
                if (!evaluation.effectiveDispositionCode) {
                    manualReviewCount += 1;
                }

                const status = evaluation.status;
                if (status === 'aktif' || status === 'akan_inaktif') aktifCount += 1;
                if (status === 'inaktif' || status === 'akan_kadaluarsa') inaktifCount += 1;
                if (status === 'kadaluarsa') kadaluarsaCount += 1;
            }

            const totalArsip = arsipLifecycleData.length;

            return {
                archiveLifecycle: {
                    aktif: aktifCount,
                    inaktif: inaktifCount,
                    kadaluarsa: kadaluarsaCount,
                    belumDitentukan,
                    held: heldCount,
                    missingTrigger: missingTriggerCount,
                    manualReview: manualReviewCount,
                    unverifiedRules: unverifiedRulesCount,
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
