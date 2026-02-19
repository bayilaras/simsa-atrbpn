
import { db } from '../config/database';
import { layananArsip, NewLayananArsip } from '../db/schema/layanan-arsip';
import { eq, desc, and, ilike, inArray, sql } from 'drizzle-orm';
import { users } from '../db/schema/users';
import { arsip } from '../db/schema/arsip';

interface LayananArsipFilters {
    page?: number;
    limit?: number;
    status?: string;
    jenisLayanan?: string;
    userId?: string; // Filter by requester
}

export class LayananArsipService {
    async create(data: NewLayananArsip) {
        return await db.transaction(async (tx) => {
            const [result] = await tx.insert(layananArsip).values({
                ...data,
                updatedAt: new Date(),
            }).returning();
            return result;
        });
    }

    async findAll(filters: LayananArsipFilters = {}) {
        const { page = 1, limit = 20, status, jenisLayanan, userId } = filters;
        const offset = (page - 1) * limit;

        const conditions = [];
        if (status) conditions.push(eq(layananArsip.status, status));
        if (jenisLayanan) conditions.push(eq(layananArsip.jenisLayanan, jenisLayanan));
        if (userId) conditions.push(eq(layananArsip.diajukanOleh, userId));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [data, totalResult] = await Promise.all([
            db.query.layananArsip.findMany({
                where: whereClause,
                with: {
                    arsip: {
                        columns: {
                            id: true,
                            nomorBerkas: true,
                            uraianBerkas: true,
                        }
                    },
                    pemohon: {
                        columns: {
                            id: true,
                            name: true,
                            unitKerjaId: true,
                        }
                    },
                    penyetuju: {
                        columns: {
                            id: true,
                            name: true,
                        }
                    }
                },
                orderBy: [desc(layananArsip.createdAt)],
                limit,
                offset,
            }),
            db.select({ count: sql<number>`count(*)` })
                .from(layananArsip)
                .where(whereClause),
        ]);

        return {
            data,
            total: Number(totalResult[0]?.count || 0),
            page,
            limit,
            totalPages: Math.ceil(Number(totalResult[0]?.count || 0) / limit),
        };
    }

    async findById(id: string) {
        return await db.query.layananArsip.findFirst({
            where: eq(layananArsip.id, id),
            with: {
                arsip: true,
                pemohon: true,
                penyetuju: true,
            }
        });
    }

    async updateStatus(id: string, status: string, approvedBy?: string, notes?: string) {
        const updateData: any = {
            status,
            updatedAt: new Date(),
        };

        if (status === 'selesai' || status === 'diproses' || status === 'ditolak') {
            if (approvedBy) updateData.disetujuiOleh = approvedBy;
            if (notes) updateData.catatanPersetujuan = notes;
            updateData.tanggalPersetujuan = new Date();
        }

        const [result] = await db.update(layananArsip)
            .set(updateData)
            .where(eq(layananArsip.id, id))
            .returning();

        return result;
    }

    async delete(id: string) {
        await db.delete(layananArsip).where(eq(layananArsip.id, id));
    }
}

export const layananArsipService = new LayananArsipService();
