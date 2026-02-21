import { db } from '../config/database';
import { suratMasuk, NewSuratMasuk, SuratMasuk } from '../db/schema';
import { eq, and, desc, asc, like, sql, gte, lte, or, ilike, isNull } from 'drizzle-orm';
import { DatabaseError } from '../utils/errors';

export interface SuratMasukFilters {
    unitKerjaId: string;
    tahun?: number;
    tanggalDari?: string;
    tanggalSampai?: string;
    jenisSurat?: string;
    sifatSurat?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
}

export class SuratMasukService {
    async findAll(filters: SuratMasukFilters) {
        const { unitKerjaId, tahun, tanggalDari, tanggalSampai, jenisSurat, sifatSurat, status, search, page = 1, limit = 20 } = filters;
        const offset = (page - 1) * limit;

        // Build where conditions
        const conditions = [
            eq(suratMasuk.unitKerjaId, unitKerjaId),
            or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted))!,  // Exclude soft-deleted records (NULL-safe)
        ];

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

    async findById(id: string) {
        const [result] = await db
            .select()
            .from(suratMasuk)
            .where(eq(suratMasuk.id, id))
            .limit(1);

        return result || null;
    }

    async create(data: NewSuratMasuk) {
        // Use transaction with row locking to prevent duplicate noUrut
        const tahun = data.tahun || new Date().getFullYear();

        try {
            const result = await db.transaction(async (tx) => {
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

    async update(id: string, data: Partial<SuratMasuk>) {
        const [result] = await db
            .update(suratMasuk)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(suratMasuk.id, id))
            .returning();

        return result;
    }

    async delete(id: string, deletedByUserId?: string) {
        // Soft delete - mark as deleted instead of permanently removing
        const [result] = await db
            .update(suratMasuk)
            .set({
                isDeleted: true,
                deletedAt: new Date(),
                deletedBy: deletedByUserId || null,
                updatedAt: new Date(),
            })
            .where(eq(suratMasuk.id, id))
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

    async archive(id: string) {
        return this.update(id, { isArchived: true });
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

    async getStats(unitKerjaId: string, tahun?: number) {
        const conditions: any[] = [
            eq(suratMasuk.unitKerjaId, unitKerjaId),
            or(eq(suratMasuk.isDeleted, false), isNull(suratMasuk.isDeleted))!,
        ];
        if (tahun) {
            conditions.push(eq(suratMasuk.tahun, tahun));
        }

        try {
            // DIAGNOSTIC: Count ALL records in table (no conditions)
            const allCount = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(suratMasuk);
            console.log('[getStats] DIAGNOSTIC - Total records in table (no filter):', allCount[0]?.count);

            // DIAGNOSTIC: Count records by unitKerjaId only
            const byUnitCount = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(suratMasuk)
                .where(eq(suratMasuk.unitKerjaId, unitKerjaId));
            console.log('[getStats] DIAGNOSTIC - Records for unitKerjaId=' + unitKerjaId + ':', byUnitCount[0]?.count);

            // DIAGNOSTIC: Get distinct unitKerjaId values
            const distinctUnits = await db
                .select({ uid: suratMasuk.unitKerjaId, count: sql<number>`count(*)::int` })
                .from(suratMasuk)
                .groupBy(suratMasuk.unitKerjaId);
            console.log('[getStats] DIAGNOSTIC - Distinct unitKerjaIds:', JSON.stringify(distinctUnits));

            // Main stats query using CASE/WHEN
            const stats = await db
                .select({
                    total: sql<number>`count(*)::int`,
                    belumDibalas: sql<number>`sum(case when ${suratMasuk.status} = 'belum_dibalas' then 1 else 0 end)::int`,
                    sudahDibalas: sql<number>`sum(case when ${suratMasuk.status} = 'sudah_dibalas' then 1 else 0 end)::int`,
                    diarsipkan: sql<number>`sum(case when ${suratMasuk.isArchived} = true then 1 else 0 end)::int`,
                })
                .from(suratMasuk)
                .where(and(...conditions));

            console.log('[getStats] unitKerjaId:', unitKerjaId, 'tahun:', tahun, 'stats result:', JSON.stringify(stats));

            const result = stats[0];
            return {
                total: result?.total ?? 0,
                belumDibalas: result?.belumDibalas ?? 0,
                sudahDibalas: result?.sudahDibalas ?? 0,
                diarsipkan: result?.diarsipkan ?? 0,
            };
        } catch (error) {
            console.error('[SuratMasukService.getStats] Query failed:', error);
            return { total: 0, belumDibalas: 0, sudahDibalas: 0, diarsipkan: 0 };
        }
    }

    // Get surat keluar yang merupakan balasan dari surat masuk ini
    async getBalasan(suratMasukId: string) {
        const { suratKeluar } = await import('../db/schema');

        const balasan = await db
            .select()
            .from(suratKeluar)
            .where(eq(suratKeluar.balasanUntuk, suratMasukId))
            .orderBy(desc(suratKeluar.createdAt));

        return balasan;
    }

    // Get all pending surat masuk (belum dibalas) for reply selection dropdown
    async getPendingForReply(unitKerjaId: string) {
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
                eq(suratMasuk.status, 'belum_dibalas')
            ))
            .orderBy(desc(suratMasuk.tanggalSurat));

        return pending;
    }

    // Get full detail with linked arsip info
    async findByIdWithLinks(id: string) {
        const surat = await this.findById(id);
        if (!surat) return null;

        const balasan = await this.getBalasan(id);

        // Check if this surat is archived
        const { arsip } = await import('../db/schema');
        const [arsipEntry] = await db
            .select()
            .from(arsip)
            .where(and(
                eq(arsip.sourceSuratId, id),
                eq(arsip.jenisArsip, 'masuk')
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

