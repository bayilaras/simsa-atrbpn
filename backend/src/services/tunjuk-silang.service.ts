import { db } from '../config/database.js';
import { tunjukSilang, NewTunjukSilang, TunjukSilang } from '../db/schema/index.js';
import { eq, or, and, desc, count, isNull } from 'drizzle-orm';

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
                and(
                    or(
                        and(
                            eq(tunjukSilang.sourceType, entityType),
                            eq(tunjukSilang.sourceId, entityId)
                        ),
                        and(
                            eq(tunjukSilang.targetType, entityType),
                            eq(tunjukSilang.targetId, entityId)
                        )
                    ),
                    isNull(tunjukSilang.cancelledAt),
                ),
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
            .where(and(
                eq(tunjukSilang.id, id),
                isNull(tunjukSilang.cancelledAt),
            ));
        return results[0] || null;
    }

    /**
     * Cancel a cross-reference while preserving its provenance
     */
    async cancel(id: string, cancelledBy: string, cancellationReason: string) {
        const [cancelled] = await db.update(tunjukSilang)
            .set({
                cancelledAt: new Date(),
                cancelledBy,
                cancellationReason,
            })
            .where(and(
                eq(tunjukSilang.id, id),
                isNull(tunjukSilang.cancelledAt),
            ))
            .returning();
        return cancelled || null;
    }

    /**
     * List all cross-references with pagination
     */
    async findAll(filters: { jenisRelasi?: string; page?: number; limit?: number } = {}) {
        const { page = 1, limit = 20 } = filters;
        const offset = (page - 1) * limit;

        const conditions = [isNull(tunjukSilang.cancelledAt)];
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
                .where(isNull(tunjukSilang.cancelledAt))
                .groupBy(tunjukSilang.jenisRelasi),

            db.select({
                sourceType: tunjukSilang.sourceType,
                count: count(),
            })
                .from(tunjukSilang)
                .where(isNull(tunjukSilang.cancelledAt))
                .groupBy(tunjukSilang.sourceType),

            db.select({ count: count() })
                .from(tunjukSilang)
                .where(isNull(tunjukSilang.cancelledAt)),
        ]);

        return { total: totalResult[0]?.count || 0, byRelasi, byType };
    }
}

export const tunjukSilangService = new TunjukSilangService();
