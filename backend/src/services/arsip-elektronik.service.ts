import { db } from '../config/database';
import { arsipElektronik, NewArsipElektronik, ArsipElektronik, arsip } from '../db/schema';
import { eq, and, desc, sql, count } from 'drizzle-orm';

interface ArsipElektronikFilters {
    arsipId?: string;
    formatFile?: string;
    statusVerifikasi?: string;
    mediaAsal?: string;
    page?: number;
    limit?: number;
}

class ArsipElektronikService {

    async findAll(filters: ArsipElektronikFilters = {}) {
        const { page = 1, limit = 20 } = filters;
        const offset = (page - 1) * limit;

        const conditions = [];
        if (filters.formatFile) conditions.push(eq(arsipElektronik.formatFile, filters.formatFile));
        if (filters.statusVerifikasi) conditions.push(eq(arsipElektronik.statusVerifikasi, filters.statusVerifikasi));
        if (filters.mediaAsal) conditions.push(eq(arsipElektronik.mediaAsal, filters.mediaAsal));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [data, totalResult] = await Promise.all([
            db.select()
                .from(arsipElektronik)
                .where(whereClause)
                .orderBy(desc(arsipElektronik.createdAt))
                .limit(limit)
                .offset(offset),
            db.select({ count: count() })
                .from(arsipElektronik)
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

    async findByArsipId(arsipId: string) {
        const results = await db.select()
            .from(arsipElektronik)
            .where(eq(arsipElektronik.arsipId, arsipId))
            .orderBy(desc(arsipElektronik.versiDokumen));
        return results;
    }

    async findById(id: string) {
        const results = await db.select()
            .from(arsipElektronik)
            .where(eq(arsipElektronik.id, id));
        return results[0] || null;
    }

    async create(data: NewArsipElektronik) {
        const result = await db.insert(arsipElektronik).values({
            ...data,
            updatedAt: new Date(),
        }).returning();
        return result[0];
    }

    async update(id: string, data: Partial<ArsipElektronik>) {
        const result = await db.update(arsipElektronik)
            .set({
                ...data,
                updatedAt: new Date(),
            })
            .where(eq(arsipElektronik.id, id))
            .returning();
        return result[0];
    }

    async verify(id: string, userId: string, status: 'verified' | 'rejected', catatan?: string) {
        const result = await db.update(arsipElektronik)
            .set({
                statusVerifikasi: status,
                verifiedBy: userId,
                verifiedAt: new Date(),
                catatanVerifikasi: catatan || null,
                updatedAt: new Date(),
            })
            .where(eq(arsipElektronik.id, id))
            .returning();
        return result[0];
    }

    async delete(id: string) {
        await db.delete(arsipElektronik).where(eq(arsipElektronik.id, id));
    }

    async findPendingVerification(page = 1, limit = 20) {
        const offset = (page - 1) * limit;
        const whereClause = eq(arsipElektronik.statusVerifikasi, 'pending');

        const [data, totalResult] = await Promise.all([
            db.select()
                .from(arsipElektronik)
                .where(whereClause)
                .orderBy(desc(arsipElektronik.createdAt))
                .limit(limit)
                .offset(offset),
            db.select({ count: count() })
                .from(arsipElektronik)
                .where(whereClause),
        ]);

        return {
            data,
            total: totalResult[0]?.count || 0,
            page,
            limit,
        };
    }

    async getStats() {
        const [byFormat, byStatus, byMedia, totalResult] = await Promise.all([
            db.select({
                formatFile: arsipElektronik.formatFile,
                count: count(),
            })
                .from(arsipElektronik)
                .groupBy(arsipElektronik.formatFile),

            db.select({
                statusVerifikasi: arsipElektronik.statusVerifikasi,
                count: count(),
            })
                .from(arsipElektronik)
                .groupBy(arsipElektronik.statusVerifikasi),

            db.select({
                mediaAsal: arsipElektronik.mediaAsal,
                count: count(),
            })
                .from(arsipElektronik)
                .groupBy(arsipElektronik.mediaAsal),

            db.select({ count: count() }).from(arsipElektronik),
        ]);

        return {
            total: totalResult[0]?.count || 0,
            byFormat,
            byStatus,
            byMedia,
        };
    }

    async addPreservationAction(data: {
        arsipElektronikId: string;
        action: string;
        details?: string;
        performedBy: string;
        notes?: string;
    }) {
        // Import dynamically to avoid circular dependency issues if any, though likely not needed here
        // better to import at top level if possible, but let's see if preservasiTrack is available
        // It is not imported at top level yet.
        const { preservasiTrack } = await import('../db/schema/preservasi-track');

        const result = await db.insert(preservasiTrack).values({
            ...data,
            performedAt: new Date(),
        }).returning();
        return result[0];
    }

    async getPreservationHistory(arsipElektronikId: string) {
        const { preservasiTrack, users } = await import('../db/schema');

        const results = await db.select({
            id: preservasiTrack.id,
            action: preservasiTrack.action,
            details: preservasiTrack.details,
            performedAt: preservasiTrack.performedAt,
            notes: preservasiTrack.notes,
            performedBy: {
                id: users.id,
                name: users.name,
                role: users.role
            }
        })
            .from(preservasiTrack)
            .leftJoin(users, eq(preservasiTrack.performedBy, users.id))
            .where(eq(preservasiTrack.arsipElektronikId, arsipElektronikId))
            .orderBy(desc(preservasiTrack.performedAt));

        return results;
    }
}

export const arsipElektronikService = new ArsipElektronikService();
