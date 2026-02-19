import { db } from '../config/database';
import { auditLog, users, arsip, suratMasuk, suratKeluar } from '../db/schema';
import { eq, and, desc, sql, gte, lte, count } from 'drizzle-orm';

export class SupervisionService {

    /**
     * Get daily activity stats for the last n days
     */
    async getActivityStats(days: number = 7) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - days);

        const stats = await db
            .select({
                date: sql<string>`to_char(${auditLog.createdAt}, 'YYYY-MM-DD')`,
                action: auditLog.action,
                count: sql<number>`count(*)::int`,
            })
            .from(auditLog)
            .where(gte(auditLog.createdAt, startDate))
            .groupBy(sql`to_char(${auditLog.createdAt}, 'YYYY-MM-DD')`, auditLog.action)
            .orderBy(sql`to_char(${auditLog.createdAt}, 'YYYY-MM-DD')`);

        // Pivot data for chart
        const dates = [...new Set(stats.map(s => s.date))].sort();
        const actions = ['create', 'update', 'delete', 'archive'];

        const chartData = dates.map(date => {
            const dayStats = stats.filter(s => s.date === date);
            const result: any = { date };
            actions.forEach(action => {
                const found = dayStats.find(s => s.action === action);
                result[action] = found?.count || 0;
            });
            return result;
        });

        return chartData;
    }

    /**
     * Get top active users
     */
    async getUserActivityStats(limit: number = 5) {
        const stats = await db
            .select({
                userId: auditLog.userId,
                userName: users.name,
                userEmail: users.email, // Fallback if name is null
                actionCount: sql<number>`count(*)::int`,
            })
            .from(auditLog)
            .leftJoin(users, eq(auditLog.userId, users.id))
            .groupBy(auditLog.userId, users.name, users.email)
            .orderBy(desc(sql`count(*)`))
            .limit(limit);

        return stats.map(s => ({
            ...s,
            userName: s.userName || s.userEmail || 'Unknown User'
        }));
    }

    /**
     * Get compliance statistics
     */
    async getComplianceStats() {
        const now = new Date();

        // 1. Archives past retention but not processed (Active retention expired)
        const overdueRetention = await db
            .select({ count: count() })
            .from(arsip)
            .where(
                and(
                    lte(arsip.tanggalKadaluarsa, now.toISOString().split('T')[0]),
                    sql`${arsip.hasilAkhir} IS NULL` // Assuming active if no final outcome
                )
            );

        // 2. Unverified Archives (if verification workflow exists)
        // Assuming 'status_verifikasi' or similar exists, or checking if verifiedBy is null
        // Based on previous tasks, we have 'statusVerifikasi' in 'arsip_elektronik'. 
        // For general arsip, let's check basic completeness or specific fields.
        // Let's use 'arsip_elektronik' for unverified count as strict verification is there.
        const { arsipElektronik } = await import('../db/schema/arsip-elektronik');

        const unverifiedElectronic = await db
            .select({ count: count() })
            .from(arsipElektronik)
            .where(eq(arsipElektronik.statusVerifikasi, 'pending'));

        // 3. Metadata Completeness (Example: missing optional but important fields like 'deskripsi' or 'box_number')
        // For now, let's count archives created this month
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const newArchives = await db
            .select({ count: count() })
            .from(arsip)
            .where(gte(arsip.createdAt, startOfMonth));

        return {
            overdueRetention: overdueRetention[0]?.count || 0,
            unverifiedElectronic: unverifiedElectronic[0]?.count || 0,
            newArchivesThisMonth: newArchives[0]?.count || 0
        };
    }
}

export const supervisionService = new SupervisionService();
