import { db } from '../config/database';
import { suratKeluar, NewSuratKeluar, SuratKeluar, suratMasuk } from '../db/schema';
import { eq, and, desc, sql, gte, lte, like } from 'drizzle-orm';
import { DatabaseError } from '../utils/errors';

export interface SuratKeluarFilters {
    unitKerjaId: string;
    tahun?: number;
    tanggalDari?: string;
    tanggalSampai?: string;
    naskahDinas?: string;
    klasifikasiFasilitatif?: string;
    klasifikasiSubstantif?: string;
    search?: string;
    page?: number;
    limit?: number;
}

export class SuratKeluarService {
    async findAll(filters: SuratKeluarFilters) {
        const { unitKerjaId, tahun, tanggalDari, tanggalSampai, naskahDinas, klasifikasiFasilitatif, klasifikasiSubstantif, search, page = 1, limit = 20 } = filters;
        const offset = (page - 1) * limit;

        const conditions = [
            eq(suratKeluar.unitKerjaId, unitKerjaId),
            eq(suratKeluar.isDeleted, false),  // Exclude soft-deleted records
        ];

        if (tahun) {
            conditions.push(eq(suratKeluar.tahun, tahun));
        }
        if (tanggalDari) {
            conditions.push(gte(suratKeluar.tanggalSurat, tanggalDari));
        }
        if (tanggalSampai) {
            conditions.push(lte(suratKeluar.tanggalSurat, tanggalSampai));
        }
        if (naskahDinas) {
            conditions.push(eq(suratKeluar.naskahDinas, naskahDinas));
        }
        if (klasifikasiFasilitatif) {
            conditions.push(like(suratKeluar.klasifikasiFasilitatif, `%${klasifikasiFasilitatif}%`));
        }
        if (klasifikasiSubstantif) {
            conditions.push(like(suratKeluar.klasifikasiSubstantif, `%${klasifikasiSubstantif}%`));
        }

        // Get total count - safely handle empty result
        const countResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(suratKeluar)
            .where(and(...conditions));

        const count = countResult?.[0]?.count ?? 0;

        const data = await db
            .select()
            .from(suratKeluar)
            .where(and(...conditions))
            .orderBy(desc(suratKeluar.createdAt))
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
            .from(suratKeluar)
            .where(eq(suratKeluar.id, id))
            .limit(1);

        return result || null;
    }

    async create(data: NewSuratKeluar) {
        const tahun = data.tahun || new Date().getFullYear();

        try {
            const result = await db.transaction(async (tx) => {
                // Lock rows for this unit+year to prevent concurrent inserts getting same noUrut
                const [lastSurat] = await tx
                    .select({ noUrut: suratKeluar.noUrut })
                    .from(suratKeluar)
                    .where(and(
                        eq(suratKeluar.unitKerjaId, data.unitKerjaId),
                        eq(suratKeluar.tahun, tahun)
                    ))
                    .orderBy(desc(suratKeluar.noUrut))
                    .limit(1)
                    .for('update');

                const noUrut = (lastSurat?.noUrut || 0) + 1;

                const [inserted] = await tx
                    .insert(suratKeluar)
                    .values({ ...data, noUrut, tahun })
                    .returning();

                // If this is a reply to surat masuk, update its status
                if (data.balasanUntuk) {
                    await tx
                        .update(suratMasuk)
                        .set({ status: 'sudah_dibalas', updatedAt: new Date() })
                        .where(eq(suratMasuk.id, data.balasanUntuk));
                }

                return inserted;
            });

            return result;
        } catch (error: any) {
            if (error.code === '40001' || error.code === '40P01') {
                throw new DatabaseError('Terjadi konflik saat membuat nomor urut surat. Silakan coba lagi.');
            }
            throw error;
        }
    }

    async update(id: string, data: Partial<SuratKeluar>) {
        const [result] = await db
            .update(suratKeluar)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(suratKeluar.id, id))
            .returning();

        return result;
    }

    async delete(id: string, deletedByUserId?: string) {
        // Soft delete - mark as deleted instead of permanently removing
        const [result] = await db
            .update(suratKeluar)
            .set({
                isDeleted: true,
                deletedAt: new Date(),
                deletedBy: deletedByUserId || null,
                updatedAt: new Date(),
            })
            .where(eq(suratKeluar.id, id))
            .returning();

        return result;
    }

    async hardDelete(id: string) {
        // Permanent delete - only for super_admin or data cleanup
        const [result] = await db
            .delete(suratKeluar)
            .where(eq(suratKeluar.id, id))
            .returning();

        return result;
    }

    async restore(id: string) {
        const [result] = await db
            .update(suratKeluar)
            .set({
                isDeleted: false,
                deletedAt: null,
                deletedBy: null,
                updatedAt: new Date(),
            })
            .where(eq(suratKeluar.id, id))
            .returning();

        return result;
    }

    async archive(id: string) {
        return this.update(id, { isArchived: true });
    }

    async getNextNumber(unitKerjaId: string, tahun?: number) {
        const year = tahun || new Date().getFullYear();

        const [lastSurat] = await db
            .select({ noUrut: suratKeluar.noUrut })
            .from(suratKeluar)
            .where(and(
                eq(suratKeluar.unitKerjaId, unitKerjaId),
                eq(suratKeluar.tahun, year)
            ))
            .orderBy(desc(suratKeluar.noUrut))
            .limit(1);

        return (lastSurat?.noUrut || 0) + 1;
    }

    async getStats(unitKerjaId: string | null, tahun?: number) {
        // Mirror dashboard pattern: conditionally apply unitKerjaId filter
        const conditions = [
            ...(unitKerjaId ? [eq(suratKeluar.unitKerjaId, unitKerjaId)] : []),
            ...(tahun ? [eq(suratKeluar.tahun, tahun)] : []),
        ];

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const stats = await db
            .select({
                total: sql<number>`count(*)::int`,
                diarsipkan: sql<number>`sum(case when ${suratKeluar.isArchived} = true then 1 else 0 end)::int`,
            })
            .from(suratKeluar)
            .where(whereClause);

        console.log('[getStats keluar] unitKerjaId:', unitKerjaId, 'result:', JSON.stringify(stats[0]));
        return stats[0];
    }

    // Get source surat masuk yang dibalas oleh surat keluar ini
    async getSourceSuratMasuk(suratKeluarId: string) {
        const sk = await this.findById(suratKeluarId);
        if (!sk || !sk.balasanUntuk) return null;

        const [sourceSurat] = await db
            .select()
            .from(suratMasuk)
            .where(eq(suratMasuk.id, sk.balasanUntuk))
            .limit(1);

        return sourceSurat || null;
    }

    // Get full detail with linked data
    async findByIdWithLinks(id: string) {
        const surat = await this.findById(id);
        if (!surat) return null;

        const sourceSuratMasuk = surat.balasanUntuk
            ? await this.getSourceSuratMasuk(id)
            : null;

        // Check if this surat is archived
        const { arsip } = await import('../db/schema');
        const [arsipEntry] = await db
            .select()
            .from(arsip)
            .where(and(
                eq(arsip.sourceSuratId, id),
                eq(arsip.jenisArsip, 'keluar')
            ))
            .limit(1);

        return {
            ...surat,
            sourceSuratMasuk,
            arsipEntry: arsipEntry || null,
        };
    }
}

export const suratKeluarService = new SuratKeluarService();

