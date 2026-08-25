import { db } from '../config/database';
import { dosir, dosirSuratMasuk, dosirSuratKeluar, suratMasuk, suratKeluar, Dosir } from '../db/schema';
import { eq, and, desc, asc, ilike, or, sql, inArray } from 'drizzle-orm';
import {
    scopedRecordByIdWhere,
    type RecordUnitScope,
} from '../utils/record-unit-scope.js';

interface CreateDosirInput {
    unitKerjaId: string;
    kode: string;
    judul: string;
    deskripsi?: string;
    kategori?: string;
    tanggalMulai?: string;
    createdBy?: string;
}

interface UpdateDosirInput {
    judul?: string;
    deskripsi?: string;
    status?: string;
    kategori?: string;
    tanggalMulai?: string;
    tanggalSelesai?: string;
}

interface DosirFilters {
    /** null is the explicit all-unit scope reserved for super_admin. */
    unitKerjaId?: RecordUnitScope;
    status?: string;
    kategori?: string;
    search?: string;
    limit?: number;
    offset?: number;
}

function incomingSecurityCondition(classes: string[] | null | undefined) {
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

function canReadLegacyOutgoing(classes: string[] | null | undefined) {
    return classes === undefined || classes === null || classes.includes('terbatas');
}

async function findAccessibleDosir(id: string, unitScope: RecordUnitScope) {
    const [result] = await db
        .select()
        .from(dosir)
        .where(scopedRecordByIdWhere(
            dosir.id,
            id,
            dosir.unitKerjaId,
            unitScope,
        ))
        .limit(1);

    return result || null;
}

export const dosirService = {
    /**
     * Create a new dosir (case file)
     */
    async create(data: CreateDosirInput) {
        const [newDosir] = await db.insert(dosir).values({
            unitKerjaId: data.unitKerjaId,
            kode: data.kode,
            judul: data.judul,
            deskripsi: data.deskripsi || null,
            kategori: data.kategori || null,
            tanggalMulai: data.tanggalMulai || null,
            createdBy: data.createdBy || null,
        }).returning();
        return newDosir;
    },

    /**
     * Update dosir details
     */
    async update(id: string, data: UpdateDosirInput, unitScope: RecordUnitScope) {
        const [updated] = await db.update(dosir)
            .set({
                ...data,
                updatedAt: new Date(),
            })
            .where(scopedRecordByIdWhere(
                dosir.id,
                id,
                dosir.unitKerjaId,
                unitScope,
            ))
            .returning();
        return updated;
    },

    /**
     * Delete dosir (cascade deletes junction table entries)
     */
    async delete(id: string, unitScope: RecordUnitScope) {
        const [deleted] = await db
            .delete(dosir)
            .where(scopedRecordByIdWhere(
                dosir.id,
                id,
                dosir.unitKerjaId,
                unitScope,
            ))
            .returning();

        return deleted || null;
    },

    /**
     * Get single dosir by ID with linked surat
     */
    async getById(
        id: string,
        unitScope: RecordUnitScope,
        securityClassifications?: string[] | null,
    ) {
        const result = await findAccessibleDosir(id, unitScope);
        if (!result) return null;

        // Get linked surat masuk
        const linkedMasuk = await db
            .select({
                link: dosirSuratMasuk,
                surat: suratMasuk,
            })
            .from(dosirSuratMasuk)
            .innerJoin(suratMasuk, eq(dosirSuratMasuk.suratMasukId, suratMasuk.id))
            .where(and(
                eq(dosirSuratMasuk.dosirId, id),
                eq(suratMasuk.unitKerjaId, result.unitKerjaId),
                incomingSecurityCondition(securityClassifications),
            ));

        // Get linked surat keluar
        const linkedKeluar = canReadLegacyOutgoing(securityClassifications) ? await db
            .select({
                link: dosirSuratKeluar,
                surat: suratKeluar,
            })
            .from(dosirSuratKeluar)
            .innerJoin(suratKeluar, eq(dosirSuratKeluar.suratKeluarId, suratKeluar.id))
            .where(and(
                eq(dosirSuratKeluar.dosirId, id),
                eq(suratKeluar.unitKerjaId, result.unitKerjaId),
            )) : [];

        return {
            ...result,
            suratMasuk: linkedMasuk.map(l => ({ ...l.surat, addedAt: l.link.addedAt, notes: l.link.notes })),
            suratKeluar: linkedKeluar.map(l => ({ ...l.surat, addedAt: l.link.addedAt, notes: l.link.notes })),
        };
    },

    /**
     * Resolve only the metadata needed for batched authorization checks.
     * This avoids loading every linked surat when a caller merely needs to
     * filter tunjuk-silang results.
     */
    async getAccessMetadata(ids: string[], unitScope: RecordUnitScope) {
        const uniqueIds = [...new Set(ids)];
        if (uniqueIds.length === 0) return [];

        return db
            .select({
                id: dosir.id,
                unitKerjaId: dosir.unitKerjaId,
                status: dosir.status,
            })
            .from(dosir)
            .where(and(
                inArray(dosir.id, uniqueIds),
                unitScope === null ? undefined : eq(dosir.unitKerjaId, unitScope),
            ));
    },

    /**
     * Get all dosir with filters
     */
    async getAll(filters: DosirFilters = {}) {
        const { unitKerjaId, status, kategori, search, limit = 50, offset = 0 } = filters;

        let query = db.select().from(dosir);
        const conditions = [];

        if (unitKerjaId !== undefined && unitKerjaId !== null) {
            conditions.push(eq(dosir.unitKerjaId, unitKerjaId));
        }
        if (status) conditions.push(eq(dosir.status, status));
        if (kategori) conditions.push(eq(dosir.kategori, kategori));
        if (search) {
            conditions.push(
                or(
                    ilike(dosir.judul, `%${search}%`),
                    ilike(dosir.kode, `%${search}%`),
                    ilike(dosir.deskripsi, `%${search}%`)
                )
            );
        }

        if (conditions.length > 0) {
            query = query.where(and(...conditions)) as typeof query;
        }

        const results = await query
            .orderBy(desc(dosir.createdAt))
            .limit(limit)
            .offset(offset);

        // Get surat counts for each dosir
        const dosirIds = results.map(d => d.id);

        const masukCounts = dosirIds.length > 0 ? await db
            .select({
                dosirId: dosirSuratMasuk.dosirId,
                count: sql<number>`count(*)::int`.as('count'),
            })
            .from(dosirSuratMasuk)
            .where(inArray(dosirSuratMasuk.dosirId, dosirIds))
            .groupBy(dosirSuratMasuk.dosirId) : [];

        const keluarCounts = dosirIds.length > 0 ? await db
            .select({
                dosirId: dosirSuratKeluar.dosirId,
                count: sql<number>`count(*)::int`.as('count'),
            })
            .from(dosirSuratKeluar)
            .where(inArray(dosirSuratKeluar.dosirId, dosirIds))
            .groupBy(dosirSuratKeluar.dosirId) : [];

        const masukMap = new Map(masukCounts.map(c => [c.dosirId, c.count]));
        const keluarMap = new Map(keluarCounts.map(c => [c.dosirId, c.count]));

        return results.map(d => ({
            ...d,
            suratMasukCount: masukMap.get(d.id) || 0,
            suratKeluarCount: keluarMap.get(d.id) || 0,
            totalSurat: (masukMap.get(d.id) || 0) + (keluarMap.get(d.id) || 0),
        }));
    },

    /**
     * Get chronological timeline of all surat in a dosir
     */
    async getTimeline(
        dosirId: string,
        unitScope: RecordUnitScope,
        securityClassifications?: string[] | null,
    ) {
        const accessibleDosir = await findAccessibleDosir(dosirId, unitScope);
        if (!accessibleDosir) return null;

        // Get surat masuk
        const masukList = await db
            .select({
                id: suratMasuk.id,
                type: sql<string>`'masuk'`.as('type'),
                tanggal: suratMasuk.tanggalSurat,
                nomorSurat: suratMasuk.nomorSurat,
                perihal: suratMasuk.perihal,
                dari: suratMasuk.dari,
                kepada: suratMasuk.kepada,
                addedAt: dosirSuratMasuk.addedAt,
            })
            .from(dosirSuratMasuk)
            .innerJoin(suratMasuk, eq(dosirSuratMasuk.suratMasukId, suratMasuk.id))
            .where(and(
                eq(dosirSuratMasuk.dosirId, dosirId),
                eq(suratMasuk.unitKerjaId, accessibleDosir.unitKerjaId),
                incomingSecurityCondition(securityClassifications),
            ));

        // Get surat keluar
        const keluarList = canReadLegacyOutgoing(securityClassifications) ? await db
            .select({
                id: suratKeluar.id,
                type: sql<string>`'keluar'`.as('type'),
                tanggal: suratKeluar.tanggalSurat,
                nomorSurat: suratKeluar.nomorSurat,
                perihal: suratKeluar.perihal,
                dari: sql<string>`'Internal'`.as('dari'),
                kepada: suratKeluar.kepada,
                addedAt: dosirSuratKeluar.addedAt,
            })
            .from(dosirSuratKeluar)
            .innerJoin(suratKeluar, eq(dosirSuratKeluar.suratKeluarId, suratKeluar.id))
            .where(and(
                eq(dosirSuratKeluar.dosirId, dosirId),
                eq(suratKeluar.unitKerjaId, accessibleDosir.unitKerjaId),
            )) : [];

        // Combine and sort by tanggal (chronologically)
        const timeline = [...masukList, ...keluarList].sort((a, b) => {
            const dateA = a.tanggal ? new Date(a.tanggal).getTime() : 0;
            const dateB = b.tanggal ? new Date(b.tanggal).getTime() : 0;
            return dateA - dateB;
        });

        return timeline;
    },

    /**
     * Add surat masuk to dosir
     */
    async addSuratMasuk(
        dosirId: string,
        suratMasukId: string,
        notes: string | undefined,
        unitScope: RecordUnitScope,
    ) {
        const accessibleDosir = await findAccessibleDosir(dosirId, unitScope);
        if (!accessibleDosir) return null;

        const [accessibleSurat] = await db
            .select({ id: suratMasuk.id })
            .from(suratMasuk)
            .where(and(
                eq(suratMasuk.id, suratMasukId),
                eq(suratMasuk.unitKerjaId, accessibleDosir.unitKerjaId),
            ))
            .limit(1);

        if (!accessibleSurat) return null;

        const [link] = await db.insert(dosirSuratMasuk).values({
            dosirId,
            suratMasukId,
            notes: notes || null,
        }).returning();
        return link;
    },

    /**
     * Add surat keluar to dosir
     */
    async addSuratKeluar(
        dosirId: string,
        suratKeluarId: string,
        notes: string | undefined,
        unitScope: RecordUnitScope,
    ) {
        const accessibleDosir = await findAccessibleDosir(dosirId, unitScope);
        if (!accessibleDosir) return null;

        const [accessibleSurat] = await db
            .select({ id: suratKeluar.id })
            .from(suratKeluar)
            .where(and(
                eq(suratKeluar.id, suratKeluarId),
                eq(suratKeluar.unitKerjaId, accessibleDosir.unitKerjaId),
            ))
            .limit(1);

        if (!accessibleSurat) return null;

        const [link] = await db.insert(dosirSuratKeluar).values({
            dosirId,
            suratKeluarId,
            notes: notes || null,
        }).returning();
        return link;
    },

    /**
     * Remove surat masuk from dosir
     */
    async removeSuratMasuk(
        dosirId: string,
        suratMasukId: string,
        unitScope: RecordUnitScope,
    ) {
        const accessibleDosir = await findAccessibleDosir(dosirId, unitScope);
        if (!accessibleDosir) return null;

        await db.delete(dosirSuratMasuk).where(
            and(
                eq(dosirSuratMasuk.dosirId, dosirId),
                eq(dosirSuratMasuk.suratMasukId, suratMasukId)
            )
        );
        return { success: true };
    },

    /**
     * Remove surat keluar from dosir
     */
    async removeSuratKeluar(
        dosirId: string,
        suratKeluarId: string,
        unitScope: RecordUnitScope,
    ) {
        const accessibleDosir = await findAccessibleDosir(dosirId, unitScope);
        if (!accessibleDosir) return null;

        await db.delete(dosirSuratKeluar).where(
            and(
                eq(dosirSuratKeluar.dosirId, dosirId),
                eq(dosirSuratKeluar.suratKeluarId, suratKeluarId)
            )
        );
        return { success: true };
    },

    /**
     * Get stats for dosir
     */
    async getStats(unitKerjaId: RecordUnitScope) {
        const conditions = unitKerjaId === null
            ? undefined
            : eq(dosir.unitKerjaId, unitKerjaId);

        const stats = await db
            .select({
                status: dosir.status,
                count: sql<number>`count(*)::int`.as('count'),
            })
            .from(dosir)
            .where(conditions)
            .groupBy(dosir.status);

        const total = stats.reduce((sum, s) => sum + s.count, 0);
        const open = stats.find(s => s.status === 'open')?.count || 0;
        const closed = stats.find(s => s.status === 'closed')?.count || 0;
        const archived = stats.find(s => s.status === 'archived')?.count || 0;

        return { total, open, closed, archived };
    },

    /**
     * Generate next kode for a unit kerja
     */
    async generateKode(unitKerjaId: string) {
        const year = new Date().getFullYear();
        const prefix = `${unitKerjaId}-${year}`;

        const existing = await db
            .select({ kode: dosir.kode })
            .from(dosir)
            .where(ilike(dosir.kode, `${prefix}%`))
            .orderBy(desc(dosir.kode))
            .limit(1);

        let nextNumber = 1;
        if (existing.length > 0) {
            const lastKode = existing[0].kode;
            const match = lastKode.match(/-(\d+)$/);
            if (match) {
                nextNumber = parseInt(match[1], 10) + 1;
            }
        }

        return `${prefix}-${nextNumber.toString().padStart(3, '0')}`;
    },

    /**
     * Get dosir IDs that a specific surat belongs to
     */
    async getDosirForSurat(suratId: string, type: 'masuk' | 'keluar') {
        if (type === 'masuk') {
            const links = await db
                .select({ dosir })
                .from(dosirSuratMasuk)
                .innerJoin(dosir, eq(dosirSuratMasuk.dosirId, dosir.id))
                .where(eq(dosirSuratMasuk.suratMasukId, suratId));
            return links.map(l => l.dosir);
        } else {
            const links = await db
                .select({ dosir })
                .from(dosirSuratKeluar)
                .innerJoin(dosir, eq(dosirSuratKeluar.dosirId, dosir.id))
                .where(eq(dosirSuratKeluar.suratKeluarId, suratId));
            return links.map(l => l.dosir);
        }
    },
};
