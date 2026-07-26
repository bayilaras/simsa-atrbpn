import { db } from '../config/database';
import { arsipTerjaga, NewArsipTerjaga, ArsipTerjaga, arsip } from '../db/schema';
import { eq, and, desc, sql, lte, ilike, or } from 'drizzle-orm';

interface ArsipTerjagaFilters {
    unitKerjaId?: string;
    kategoriTerjaga?: string;
    statusPelaporan?: string;
    statusKepatuhan?: string;
    search?: string;
    page?: number;
    limit?: number;
}

class ArsipTerjagaService {

    // List all arsip terjaga with pagination and filters
    async findAll(filters: ArsipTerjagaFilters) {
        const {
            unitKerjaId,
            kategoriTerjaga,
            statusPelaporan,
            statusKepatuhan,
            search,
            page = 1,
            limit = 20
        } = filters;

        const conditions = [];

        if (unitKerjaId) {
            conditions.push(eq(arsipTerjaga.unitKerjaId, unitKerjaId));
        }
        if (kategoriTerjaga) {
            conditions.push(eq(arsipTerjaga.kategoriTerjaga, kategoriTerjaga));
        }
        if (statusPelaporan) {
            conditions.push(eq(arsipTerjaga.statusPelaporan, statusPelaporan));
        }
        if (statusKepatuhan) {
            conditions.push(eq(arsipTerjaga.statusKepatuhan, statusKepatuhan));
        }
        if (search) {
            conditions.push(
                or(
                    ilike(arsipTerjaga.dasarHukum, `%${search}%`),
                    ilike(arsipTerjaga.uraianIsi, `%${search}%`),
                    ilike(arsipTerjaga.catatan, `%${search}%`),
                    ilike(arsipTerjaga.nomorLaporanANRI, `%${search}%`)
                )!
            );
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [data, countResult] = await Promise.all([
            db.select({
                id: arsipTerjaga.id,
                arsipId: arsipTerjaga.arsipId,
                unitKerjaId: arsipTerjaga.unitKerjaId,
                kategoriTerjaga: arsipTerjaga.kategoriTerjaga,
                dasarHukum: arsipTerjaga.dasarHukum,
                uraianIsi: arsipTerjaga.uraianIsi,
                statusPelaporan: arsipTerjaga.statusPelaporan,
                tanggalPelaporan: arsipTerjaga.tanggalPelaporan,
                nomorLaporanANRI: arsipTerjaga.nomorLaporanANRI,
                periodePelaporanHari: arsipTerjaga.periodePelaporanHari,
                tanggalPenetapan: arsipTerjaga.tanggalPenetapan,
                tanggalReviewSelanjutnya: arsipTerjaga.tanggalReviewSelanjutnya,
                statusKepatuhan: arsipTerjaga.statusKepatuhan,
                catatan: arsipTerjaga.catatan,
                createdAt: arsipTerjaga.createdAt,
                // Joined arsip info
                nomorBerkas: arsip.nomorBerkas,
                kodeKlasifikasi: arsip.kodeKlasifikasi,
                uraianBerkas: arsip.uraianBerkas,
                nomorSuratOriginal: arsip.nomorSuratOriginal,
                perihalOriginal: arsip.perihalOriginal,
                kurunWaktu: arsip.kurunWaktu,
            })
                .from(arsipTerjaga)
                .leftJoin(arsip, eq(arsipTerjaga.arsipId, arsip.id))
                .where(whereClause)
                .orderBy(desc(arsipTerjaga.createdAt))
                .limit(limit)
                .offset((page - 1) * limit),

            db.select({ count: sql<number>`count(*)::int` })
                .from(arsipTerjaga)
                .where(whereClause),
        ]);

        const total = countResult[0]?.count ?? 0;

        return {
            data,
            total,
            page,
            totalPages: Math.ceil(total / limit),
        };
    }

    // Get single arsip terjaga with arsip details
    async findById(id: string) {
        const [result] = await db
            .select({
                id: arsipTerjaga.id,
                arsipId: arsipTerjaga.arsipId,
                unitKerjaId: arsipTerjaga.unitKerjaId,
                kategoriTerjaga: arsipTerjaga.kategoriTerjaga,
                dasarHukum: arsipTerjaga.dasarHukum,
                uraianIsi: arsipTerjaga.uraianIsi,
                statusPelaporan: arsipTerjaga.statusPelaporan,
                tanggalPelaporan: arsipTerjaga.tanggalPelaporan,
                nomorLaporanANRI: arsipTerjaga.nomorLaporanANRI,
                periodePelaporanHari: arsipTerjaga.periodePelaporanHari,
                tanggalPenetapan: arsipTerjaga.tanggalPenetapan,
                tanggalReviewSelanjutnya: arsipTerjaga.tanggalReviewSelanjutnya,
                statusKepatuhan: arsipTerjaga.statusKepatuhan,
                catatan: arsipTerjaga.catatan,
                createdBy: arsipTerjaga.createdBy,
                createdAt: arsipTerjaga.createdAt,
                updatedAt: arsipTerjaga.updatedAt,
                // Joined arsip info
                nomorBerkas: arsip.nomorBerkas,
                kodeKlasifikasi: arsip.kodeKlasifikasi,
                uraianBerkas: arsip.uraianBerkas,
                uraianItem: arsip.uraianItem,
                nomorSuratOriginal: arsip.nomorSuratOriginal,
                tanggalSuratOriginal: arsip.tanggalSuratOriginal,
                perihalOriginal: arsip.perihalOriginal,
                jenisArsip: arsip.jenisArsip,
            })
            .from(arsipTerjaga)
            .leftJoin(arsip, eq(arsipTerjaga.arsipId, arsip.id))
            .where(eq(arsipTerjaga.id, id))
            .limit(1);

        return result || null;
    }

    // Designate an archive as terjaga
    async create(data: NewArsipTerjaga) {
        const [result] = await db.insert(arsipTerjaga).values({
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
        }).returning();
        return result;
    }

    // Update arsip terjaga
    async update(id: string, data: Partial<ArsipTerjaga>) {
        const [result] = await db
            .update(arsipTerjaga)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(arsipTerjaga.id, id))
            .returning();
        return result;
    }

    // Remove terjaga designation
    async delete(id: string) {
        const [result] = await db
            .delete(arsipTerjaga)
            .where(eq(arsipTerjaga.id, id))
            .returning();
        return result;
    }

    // Mark as reported to ANRI
    async markAsReported(id: string, nomorLaporan: string, tanggalPelaporan: string) {
        const [result] = await db
            .update(arsipTerjaga)
            .set({
                statusPelaporan: 'dilaporkan',
                nomorLaporanANRI: nomorLaporan,
                tanggalPelaporan: tanggalPelaporan,
                statusKepatuhan: 'patuh',
                updatedAt: new Date(),
            })
            .where(eq(arsipTerjaga.id, id))
            .returning();
        return result;
    }

    // Get statistics for dashboard
    async getStats(unitKerjaId: string) {
        const conditions = [eq(arsipTerjaga.unitKerjaId, unitKerjaId)];

        const [total, byKategori, byPelaporan, byKepatuhan] = await Promise.all([
            db.select({ count: sql<number>`count(*)::int` })
                .from(arsipTerjaga)
                .where(and(...conditions)),

            db.select({
                kategori: arsipTerjaga.kategoriTerjaga,
                count: sql<number>`count(*)::int`,
            })
                .from(arsipTerjaga)
                .where(and(...conditions))
                .groupBy(arsipTerjaga.kategoriTerjaga),

            db.select({
                status: arsipTerjaga.statusPelaporan,
                count: sql<number>`count(*)::int`,
            })
                .from(arsipTerjaga)
                .where(and(...conditions))
                .groupBy(arsipTerjaga.statusPelaporan),

            db.select({
                status: arsipTerjaga.statusKepatuhan,
                count: sql<number>`count(*)::int`,
            })
                .from(arsipTerjaga)
                .where(and(...conditions))
                .groupBy(arsipTerjaga.statusKepatuhan),
        ]);

        return {
            total: total[0]?.count ?? 0,
            byKategori,
            byPelaporan,
            byKepatuhan,
        };
    }

    // Get arsip terjaga approaching reporting deadline
    async getDueForReporting(unitKerjaId: string, daysAhead: number = 30) {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + daysAhead);
        const futureDateStr = futureDate.toISOString().split('T')[0];

        const results = await db
            .select({
                id: arsipTerjaga.id,
                arsipId: arsipTerjaga.arsipId,
                kategoriTerjaga: arsipTerjaga.kategoriTerjaga,
                statusPelaporan: arsipTerjaga.statusPelaporan,
                tanggalPelaporan: arsipTerjaga.tanggalPelaporan,
                tanggalReviewSelanjutnya: arsipTerjaga.tanggalReviewSelanjutnya,
                nomorLaporanANRI: arsipTerjaga.nomorLaporanANRI,
                statusKepatuhan: arsipTerjaga.statusKepatuhan,
                nomorBerkas: arsip.nomorBerkas,
                uraianBerkas: arsip.uraianBerkas,
                nomorSuratOriginal: arsip.nomorSuratOriginal,
            })
            .from(arsipTerjaga)
            .leftJoin(arsip, eq(arsipTerjaga.arsipId, arsip.id))
            .where(
                and(
                    eq(arsipTerjaga.unitKerjaId, unitKerjaId),
                    eq(arsipTerjaga.statusPelaporan, 'belum_dilaporkan'),
                    sql`COALESCE(
                        ${arsipTerjaga.tanggalReviewSelanjutnya},
                        ${arsipTerjaga.tanggalPenetapan} + make_interval(days => COALESCE(${arsipTerjaga.periodePelaporanHari}, 365))
                    ) <= ${futureDateStr}::date`
                )
            )
            .orderBy(arsipTerjaga.tanggalPenetapan);

        return results;
    }

    // Generate ANRI report data
    async generateLaporanANRI(unitKerjaId: string, tahun?: number) {
        const conditions = [eq(arsipTerjaga.unitKerjaId, unitKerjaId)];
        if (tahun) {
            conditions.push(sql`EXTRACT(YEAR FROM ${arsipTerjaga.tanggalPenetapan}) = ${tahun}`);
        }

        const results = await db
            .select({
                id: arsipTerjaga.id,
                arsipId: arsipTerjaga.arsipId,
                kategoriTerjaga: arsipTerjaga.kategoriTerjaga,
                dasarHukum: arsipTerjaga.dasarHukum,
                uraianIsi: arsipTerjaga.uraianIsi,
                statusPelaporan: arsipTerjaga.statusPelaporan,
                tanggalPelaporan: arsipTerjaga.tanggalPelaporan,
                nomorLaporanANRI: arsipTerjaga.nomorLaporanANRI,
                tanggalPenetapan: arsipTerjaga.tanggalPenetapan,
                statusKepatuhan: arsipTerjaga.statusKepatuhan,
                catatan: arsipTerjaga.catatan,
                // Arsip details
                nomorBerkas: arsip.nomorBerkas,
                kodeKlasifikasi: arsip.kodeKlasifikasi,
                uraianBerkas: arsip.uraianBerkas,
                nomorSuratOriginal: arsip.nomorSuratOriginal,
                tanggalSuratOriginal: arsip.tanggalSuratOriginal,
                perihalOriginal: arsip.perihalOriginal,
                kurunWaktu: arsip.kurunWaktu,
                jumlah: arsip.jumlah,
            })
            .from(arsipTerjaga)
            .leftJoin(arsip, eq(arsipTerjaga.arsipId, arsip.id))
            .where(and(...conditions))
            .orderBy(arsipTerjaga.kategoriTerjaga, arsipTerjaga.tanggalPenetapan);

        // Group by kategori for the report
        const grouped: Record<string, typeof results> = {};
        for (const item of results) {
            const kat = item.kategoriTerjaga;
            if (!grouped[kat]) grouped[kat] = [];
            grouped[kat].push(item);
        }

        return {
            unitKerjaId,
            tahun: tahun || new Date().getFullYear(),
            tanggalLaporan: new Date().toISOString().split('T')[0],
            totalArsipTerjaga: results.length,
            dataPerKategori: grouped,
            data: results,
        };
    }
}

export const arsipTerjagaService = new ArsipTerjagaService();
