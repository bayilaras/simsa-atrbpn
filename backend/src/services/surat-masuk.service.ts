import { db } from '../config/database';
import { suratMasuk, NewSuratMasuk, SuratMasuk } from '../db/schema';
import { eq, and, desc, asc, like, sql, gte, lte, or, ilike, isNull, inArray } from 'drizzle-orm';
import { DatabaseError } from '../utils/errors';
import {
    scopedRecordByIdWhere,
    type RecordUnitScope,
} from '../utils/record-unit-scope.js';

export interface SuratMasukFilters {
    unitKerjaId?: string | null;
    tahun?: number;
    tanggalDari?: string;
    tanggalSampai?: string;
    jenisSurat?: string;
    sifatSurat?: string;
    status?: string;
    disposisi?: string;
    search?: string;
    page?: number;
    limit?: number;
    /** null means all classes (super_admin); [] fails closed. */
    securityClassifications?: string[] | null;
}

function securityClassificationCondition(classes: string[] | null | undefined) {
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

export class SuratMasukService {
    async findAll(filters: SuratMasukFilters) {
        const { unitKerjaId, tahun, tanggalDari, tanggalSampai, jenisSurat, sifatSurat, status, disposisi, search, page = 1, limit = 20, securityClassifications } = filters;
        const offset = (page - 1) * limit;

        // Build where conditions
        const conditions = [
            or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted))!,  // Exclude soft-deleted records (NULL-safe)
        ];

        // Only filter by unitKerjaId when provided (super_admin sees all)
        if (unitKerjaId !== null && unitKerjaId !== undefined) {
            conditions.push(eq(suratMasuk.unitKerjaId, unitKerjaId));
        }
        const classificationCondition = securityClassificationCondition(securityClassifications);
        if (classificationCondition) conditions.push(classificationCondition);

        if (tahun) {
            conditions.push(eq(suratMasuk.tahun, tahun));
        }
        if (tanggalDari) {
            conditions.push(gte(suratMasuk.tanggalSurat, tanggalDari));
        }
        if (tanggalSampai) {
            conditions.push(lte(suratMasuk.tanggalSurat, tanggalSampai));
        }
        if (jenisSurat) {
            conditions.push(eq(suratMasuk.jenisSurat, jenisSurat));
        }
        if (sifatSurat) {
            conditions.push(eq(suratMasuk.sifatSurat, sifatSurat));
        }
        if (status) {
            conditions.push(eq(suratMasuk.status, status));
        }
        if (disposisi) {
            conditions.push(sql`${suratMasuk.disposisi} @> ARRAY[${disposisi}]`);
        }

        // Search across multiple fields using ILIKE (case-insensitive)
        if (search && search.trim()) {
            const searchPattern = `%${search.trim()}%`;
            conditions.push(
                or(
                    ilike(suratMasuk.perihal, searchPattern),
                    ilike(suratMasuk.nomorSurat, searchPattern),
                    ilike(suratMasuk.dari, searchPattern)
                )!
            );
        }

        // Get total count - safely handle empty result
        const countResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(suratMasuk)
            .where(and(...conditions));

        const count = countResult?.[0]?.count ?? 0;

        // Get data
        const data = await db
            .select()
            .from(suratMasuk)
            .where(and(...conditions))
            .orderBy(desc(suratMasuk.createdAt))
            .limit(limit)
            .offset(offset);

        return {
            data: data || [],
            pagination: {
                page,
                limit,
                total: count,
                totalPages: Math.ceil(count / limit) || 1,
            },
        };
    }

    async findById(id: string, unitScope: RecordUnitScope) {
        const conditions = [
            scopedRecordByIdWhere(
                suratMasuk.id,
                id,
                suratMasuk.unitKerjaId,
                unitScope,
            ),
            or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted))!,  // Exclude soft-deleted records (NULL-safe)
        ];

        const [result] = await db
            .select()
            .from(suratMasuk)
            .where(and(...conditions))
            .limit(1);

        return result || null;
    }

    async create(data: NewSuratMasuk) {
        // Use transaction with row locking to prevent duplicate noUrut
        const tahun = data.tahun || new Date().getFullYear();

        try {
            const result = await db.transaction(async (tx: any) => {
                // Lock rows for this unit+year to prevent concurrent inserts getting same noUrut
                const [lastSurat] = await tx
                    .select({ noUrut: suratMasuk.noUrut })
                    .from(suratMasuk)
                    .where(and(
                        eq(suratMasuk.unitKerjaId, data.unitKerjaId),
                        eq(suratMasuk.tahun, tahun)
                    ))
                    .orderBy(desc(suratMasuk.noUrut))
                    .limit(1)
                    .for('update');

                const noUrut = (lastSurat?.noUrut || 0) + 1;

                const [inserted] = await tx
                    .insert(suratMasuk)
                    .values({ ...data, noUrut, tahun })
                    .returning();

                return inserted;
            });

            return result;
        } catch (error: any) {
            // Handle serialization/deadlock errors with a retry
            if (error.code === '40001' || error.code === '40P01') {
                throw new DatabaseError('Terjadi konflik saat membuat nomor urut surat. Silakan coba lagi.');
            }
            throw error;
        }
    }

    async update(id: string, data: Partial<SuratMasuk>, unitScope: RecordUnitScope) {
        const conditions = [
            scopedRecordByIdWhere(
                suratMasuk.id,
                id,
                suratMasuk.unitKerjaId,
                unitScope,
            ),
            or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted))!,  // Never mutate soft-deleted records (NULL-safe)
        ];

        const [result] = await db
            .update(suratMasuk)
            .set({ ...data, updatedAt: new Date() })
            .where(and(...conditions))
            .returning();

        return result;
    }

    async delete(id: string, deletedByUserId: string | undefined, unitScope: RecordUnitScope) {
        // Soft delete - mark as deleted instead of permanently removing
        const conditions = [
            scopedRecordByIdWhere(
                suratMasuk.id,
                id,
                suratMasuk.unitKerjaId,
                unitScope,
            ),
            or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted))!,  // Keep deletedAt/deletedBy of an already deleted record intact
        ];

        const [result] = await db
            .update(suratMasuk)
            .set({
                isDeleted: true,
                deletedAt: new Date(),
                deletedBy: deletedByUserId || null,
                updatedAt: new Date(),
            })
            .where(and(...conditions))
            .returning();

        return result;
    }

    async hardDelete(id: string) {
        // Permanent delete - only for super_admin or data cleanup
        const [result] = await db
            .delete(suratMasuk)
            .where(eq(suratMasuk.id, id))
            .returning();

        return result;
    }

    async restore(id: string) {
        const [result] = await db
            .update(suratMasuk)
            .set({
                isDeleted: false,
                deletedAt: null,
                deletedBy: null,
                updatedAt: new Date(),
            })
            .where(eq(suratMasuk.id, id))
            .returning();

        return result;
    }

    async archive(id: string, unitScope: RecordUnitScope) {
        return this.update(id, { isArchived: true }, unitScope);
    }

    async getNextNumber(unitKerjaId: string, tahun?: number) {
        const year = tahun || new Date().getFullYear();

        const [lastSurat] = await db
            .select({ noUrut: suratMasuk.noUrut })
            .from(suratMasuk)
            .where(and(
                eq(suratMasuk.unitKerjaId, unitKerjaId),
                eq(suratMasuk.tahun, year)
            ))
            .orderBy(desc(suratMasuk.noUrut))
            .limit(1);

        return (lastSurat?.noUrut || 0) + 1;
    }

    async getStats(
        unitKerjaId: string | null,
        tahun?: number,
        securityClassifications?: string[] | null,
    ) {
        try {
            // Mirror dashboard service pattern exactly:
            // - When unitKerjaId is null → skip WHERE clause (query all records)
            // - Use individual count queries in parallel (proven working in dashboard)
            // Dashboard shows 1721 surat masuk correctly using this approach

            const classificationCondition = securityClassificationCondition(securityClassifications);
            const baseConditions = [
                or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted))!,
                ...(unitKerjaId !== null ? [eq(suratMasuk.unitKerjaId, unitKerjaId)] : []),
                ...(tahun ? [eq(suratMasuk.tahun, tahun)] : []),
                ...(classificationCondition ? [classificationCondition] : []),
            ];

            // Run all counts in parallel (same approach as dashboard service)
            const [
                [totalResult],
                [belumDibalasResult],
                [sudahDibalasResult],
                [diarsipkanResult],
            ] = await Promise.all([
                db.select({ count: sql<number>`count(*)::int` })
                    .from(suratMasuk)
                    .where(and(...baseConditions)),
                db.select({ count: sql<number>`count(*)::int` })
                    .from(suratMasuk)
                    .where(and(...baseConditions, eq(suratMasuk.status, 'belum_dibalas'))),
                db.select({ count: sql<number>`count(*)::int` })
                    .from(suratMasuk)
                    .where(and(...baseConditions, eq(suratMasuk.status, 'sudah_dibalas'))),
                db.select({ count: sql<number>`count(*)::int` })
                    .from(suratMasuk)
                    .where(and(...baseConditions, eq(suratMasuk.isArchived, true))),
            ]);

            const result = {
                total: totalResult?.count || 0,
                belumDibalas: belumDibalasResult?.count || 0,
                sudahDibalas: sudahDibalasResult?.count || 0,
                diarsipkan: diarsipkanResult?.count || 0,
            };

            console.log('[getStats] unitKerjaId:', unitKerjaId, 'result:', JSON.stringify(result));
            return result;
        } catch (error) {
            console.error('[SuratMasukService.getStats] Query failed:', error);
            return { total: 0, belumDibalas: 0, sudahDibalas: 0, diarsipkan: 0 };
        }
    }

    // Get surat keluar yang merupakan balasan dari surat masuk ini
    async getBalasan(suratMasukId: string, unitKerjaId: string) {
        const { suratKeluar } = await import('../db/schema');

        const balasan = await db
            .select()
            .from(suratKeluar)
            .where(and(
                eq(suratKeluar.balasanUntuk, suratMasukId),
                eq(suratKeluar.unitKerjaId, unitKerjaId),
                or(eq(suratKeluar.isDeleted, false), isNull(suratKeluar.isDeleted))!  // Exclude soft-deleted records (NULL-safe)
            ))
            .orderBy(desc(suratKeluar.createdAt));

        return balasan;
    }

    // Get all pending surat masuk (belum dibalas) for reply selection dropdown
    async getPendingForReply(
        unitKerjaId: string,
        securityClassifications?: string[] | null,
    ) {
        const classificationCondition = securityClassificationCondition(securityClassifications);
        const pending = await db
            .select({
                id: suratMasuk.id,
                nomorSurat: suratMasuk.nomorSurat,
                perihal: suratMasuk.perihal,
                tanggalSurat: suratMasuk.tanggalSurat,
                dari: suratMasuk.dari,
            })
            .from(suratMasuk)
            .where(and(
                eq(suratMasuk.unitKerjaId, unitKerjaId),
                ...(classificationCondition ? [classificationCondition] : []),
                eq(suratMasuk.status, 'belum_dibalas'),
                or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted))!  // Exclude soft-deleted records (NULL-safe)
            ))
            .orderBy(desc(suratMasuk.tanggalSurat));

        return pending;
    }

    // Get full detail with linked arsip info
    async findByIdWithLinks(id: string, unitScope: RecordUnitScope) {
        const surat = await this.findById(id, unitScope);
        if (!surat) return null;

        const balasan = await this.getBalasan(id, surat.unitKerjaId);

        // Check if this surat is archived
        const { arsip } = await import('../db/schema');
        const [arsipEntry] = await db
            .select()
            .from(arsip)
            .where(and(
                eq(arsip.sourceSuratId, id),
                eq(arsip.jenisArsip, 'masuk'),
                eq(arsip.unitKerjaId, surat.unitKerjaId)
            ))
            .limit(1);

        return {
            ...surat,
            balasan,
            arsipEntry: arsipEntry || null,
        };
    }
}

export const suratMasukService = new SuratMasukService();
