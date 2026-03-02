import { db } from '../config/database.js';
import { tunjukSilang, NewTunjukSilang, TunjukSilang } from '../db/schema/index.js';
import { eq, or, and, desc, count } from 'drizzle-orm';

const VALID_ENTITY_TYPES = ['arsip', 'surat_masuk', 'surat_keluar', 'dosir'];
const VALID_RELASI_TYPES = ['balasan', 'tindak_lanjut', 'lampiran', 'referensi', 'revisi', 'duplikat', 'berkaitan'];

class TunjukSilangService {

    /**
     * Create a cross-reference between two entities
     */
    async create(data: NewTunjukSilang) {
        if (!VALID_ENTITY_TYPES.includes(data.sourceType)) {
            throw new Error(`Invalid sourceType: ${data.sourceType}`);
        }
        if (!VALID_ENTITY_TYPES.includes(data.targetType)) {
            throw new Error(`Invalid targetType: ${data.targetType}`);
        }
        if (!VALID_RELASI_TYPES.includes(data.jenisRelasi)) {
            throw new Error(`Invalid jenisRelasi: ${data.jenisRelasi}`);
        }

        const result = await db.insert(tunjukSilang).values(data).returning();
        return result[0];
    }

    /**
     * Find all cross-references for a given entity (both as source and target)
     */
    async findByEntity(entityType: string, entityId: string) {
        const results = await db.select()
            .from(tunjukSilang)
            .where(
                or(
                    and(
                        eq(tunjukSilang.sourceType, entityType),
                        eq(tunjukSilang.sourceId, entityId)
                    ),
                    and(
                        eq(tunjukSilang.targetType, entityType),
                        eq(tunjukSilang.targetId, entityId)
                    )
                )
            )
            .orderBy(desc(tunjukSilang.createdAt));

        // Normalize: for each result, determine direction relative to the queried entity
        return results.map((ref: any) => {
            const isSource = ref.sourceType === entityType && ref.sourceId === entityId;
            return {
                ...ref,
                direction: isSource ? 'outgoing' : 'incoming',
                relatedType: isSource ? ref.targetType : ref.sourceType,
                relatedId: isSource ? ref.targetId : ref.sourceId,
            };
        });
    }

    /**
     * Find a single cross-reference by ID
     */
    async findById(id: string) {
        const results = await db.select()
            .from(tunjukSilang)
            .where(eq(tunjukSilang.id, id));
        return results[0] || null;
    }

    /**
     * Delete a cross-reference
     */
    async delete(id: string) {
        await db.delete(tunjukSilang).where(eq(tunjukSilang.id, id));
    }

    /**
     * List all cross-references with pagination
     */
    async findAll(filters: { jenisRelasi?: string; page?: number; limit?: number } = {}) {
        const { page = 1, limit = 20 } = filters;
        const offset = (page - 1) * limit;

        const conditions = [];
        if (filters.jenisRelasi) conditions.push(eq(tunjukSilang.jenisRelasi, filters.jenisRelasi));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [data, totalResult] = await Promise.all([
            db.select()
                .from(tunjukSilang)
                .where(whereClause)
                .orderBy(desc(tunjukSilang.createdAt))
                .limit(limit)
                .offset(offset),
            db.select({ count: count() })
                .from(tunjukSilang)
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

    /**
     * Get statistics about cross-references
     */
    async getStats() {
        const [byRelasi, byType, totalResult] = await Promise.all([
            db.select({
                jenisRelasi: tunjukSilang.jenisRelasi,
                count: count(),
            })
                .from(tunjukSilang)
                .groupBy(tunjukSilang.jenisRelasi),

            db.select({
                sourceType: tunjukSilang.sourceType,
                count: count(),
            })
                .from(tunjukSilang)
                .groupBy(tunjukSilang.sourceType),

            db.select({ count: count() }).from(tunjukSilang),
        ]);

        return { total: totalResult[0]?.count || 0, byRelasi, byType };
    }
}

export const tunjukSilangService = new TunjukSilangService();
