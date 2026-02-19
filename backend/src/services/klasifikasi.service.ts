import { db } from '../config/database';
import { klasifikasiArsip, jadwalRetensiArsip, NewKlasifikasiArsip, NewJadwalRetensiArsip, klasifikasiJraMapping } from '../db/schema';
import { eq, and, like, isNull, or } from 'drizzle-orm';

// Tree node interface for hierarchical response
interface KlasifikasiTreeNode {
    id: number;
    kode: string;
    jenis: string;
    keterangan: string | null;
    kategori: string | null;
    parentKode: string | null;
    tipe: string;
    level: number;
    isActive: boolean;
    children?: KlasifikasiTreeNode[];
}

// Build tree structure from flat data
function buildTree(items: KlasifikasiTreeNode[], parentKode: string | null = null): KlasifikasiTreeNode[] {
    return items
        .filter(item => item.parentKode === parentKode)
        .map(item => ({
            ...item,
            children: buildTree(items, item.kode)
        }));
}

class KlasifikasiService {
    // Get all klasifikasi with optional filters
    async getAll(filters: { tipe?: string; search?: string; activeOnly?: boolean } = {}) {
        const conditions = [];

        if (filters.tipe) {
            conditions.push(eq(klasifikasiArsip.tipe, filters.tipe));
        }

        if (filters.activeOnly !== false) {
            conditions.push(eq(klasifikasiArsip.isActive, true));
        }

        if (filters.search) {
            conditions.push(
                or(
                    like(klasifikasiArsip.kode, `%${filters.search}%`),
                    like(klasifikasiArsip.jenis, `%${filters.search}%`)
                )
            );
        }

        const data = await db
            .select()
            .from(klasifikasiArsip)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(klasifikasiArsip.kode);

        return data;
    }

    // Get as tree structure
    async getTree(tipe?: string) {
        const conditions = [eq(klasifikasiArsip.isActive, true)];
        if (tipe) {
            conditions.push(eq(klasifikasiArsip.tipe, tipe));
        }

        const flatData = await db
            .select()
            .from(klasifikasiArsip)
            .where(and(...conditions))
            .orderBy(klasifikasiArsip.kode);

        // Build tree from root items (parentKode === null)
        const tree = buildTree(flatData as KlasifikasiTreeNode[], null);
        return tree;
    }

    // Get by kode
    async getByKode(kode: string) {
        const [item] = await db
            .select()
            .from(klasifikasiArsip)
            .where(eq(klasifikasiArsip.kode, kode))
            .limit(1);

        return item || null;
    }

    // Get children by parent kode
    async getChildren(parentKode: string) {
        const children = await db
            .select()
            .from(klasifikasiArsip)
            .where(and(
                eq(klasifikasiArsip.parentKode, parentKode),
                eq(klasifikasiArsip.isActive, true)
            ))
            .orderBy(klasifikasiArsip.kode);

        return children;
    }

    // Create new klasifikasi
    async create(data: NewKlasifikasiArsip) {
        const [created] = await db
            .insert(klasifikasiArsip)
            .values(data)
            .returning();

        return created;
    }

    // Update klasifikasi
    async update(kode: string, data: Partial<NewKlasifikasiArsip>) {
        const [updated] = await db
            .update(klasifikasiArsip)
            .set(data)
            .where(eq(klasifikasiArsip.kode, kode))
            .returning();

        return updated || null;
    }

    // Soft delete (set isActive = false)
    async delete(kode: string) {
        const [deleted] = await db
            .update(klasifikasiArsip)
            .set({ isActive: false })
            .where(eq(klasifikasiArsip.kode, kode))
            .returning();

        return deleted || null;
    }

    // Get statistics
    async getStats() {
        const all = await db.select().from(klasifikasiArsip).where(eq(klasifikasiArsip.isActive, true));

        const fasilitatif = all.filter(i => i.tipe === 'fasilitatif');
        const substantif = all.filter(i => i.tipe === 'substantif');

        return {
            total: all.length,
            fasilitatif: fasilitatif.length,
            substantif: substantif.length,
            rootFasilitatif: fasilitatif.filter(i => i.level === 0).length,
            rootSubstantif: substantif.filter(i => i.level === 0).length,
        };
    }
}

// JRA Service (similar structure)
class JRAService {
    async getAll(filters: { tipe?: string; search?: string; activeOnly?: boolean } = {}) {
        const conditions = [];

        if (filters.tipe) {
            conditions.push(eq(jadwalRetensiArsip.tipe, filters.tipe));
        }

        if (filters.activeOnly !== false) {
            conditions.push(eq(jadwalRetensiArsip.isActive, true));
        }

        if (filters.search) {
            conditions.push(
                or(
                    like(jadwalRetensiArsip.kode, `%${filters.search}%`),
                    like(jadwalRetensiArsip.uraian, `%${filters.search}%`)
                )
            );
        }

        const data = await db
            .select()
            .from(jadwalRetensiArsip)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(jadwalRetensiArsip.kode);

        return data;
    }

    async getTree(tipe?: string) {
        const conditions = [eq(jadwalRetensiArsip.isActive, true)];
        if (tipe) {
            conditions.push(eq(jadwalRetensiArsip.tipe, tipe));
        }

        const flatData = await db
            .select()
            .from(jadwalRetensiArsip)
            .where(and(...conditions))
            .orderBy(jadwalRetensiArsip.kode);

        // Build tree from root items
        const buildJRATree = (items: any[], parentKode: string | null = null): any[] => {
            return items
                .filter(item => item.parentKode === parentKode)
                .map(item => ({
                    ...item,
                    children: buildJRATree(items, item.kode)
                }));
        };

        return buildJRATree(flatData, null);
    }

    async getByKode(kode: string) {
        const [item] = await db
            .select()
            .from(jadwalRetensiArsip)
            .where(eq(jadwalRetensiArsip.kode, kode))
            .limit(1);

        return item || null;
    }

    async create(data: NewJadwalRetensiArsip) {
        const [created] = await db
            .insert(jadwalRetensiArsip)
            .values(data)
            .returning();

        return created;
    }

    async update(kode: string, data: Partial<NewJadwalRetensiArsip>) {
        const [updated] = await db
            .update(jadwalRetensiArsip)
            .set(data)
            .where(eq(jadwalRetensiArsip.kode, kode))
            .returning();

        return updated || null;
    }

    async delete(kode: string) {
        const [deleted] = await db
            .update(jadwalRetensiArsip)
            .set({ isActive: false })
            .where(eq(jadwalRetensiArsip.kode, kode))
            .returning();

        return deleted || null;
    }
}

export const klasifikasiService = new KlasifikasiService();
export const jraService = new JRAService();

// Mapping Service - pemetaan tematik Klasifikasi ↔ JRA
class MappingService {
    // Get all thematic mappings
    async getAllMappings() {
        const data = await db
            .select()
            .from(klasifikasiJraMapping)
            .where(eq(klasifikasiJraMapping.isActive, true))
            .orderBy(klasifikasiJraMapping.tema);

        return data;
    }

    // Get suggested JRA items based on klasifikasi kode
    // e.g., 'KU.01.02' → prefix 'KU' → maps to JRA prefix 'F.I' → returns all JRA items starting with 'F.I'
    async getSuggestedJRA(klasifikasiKode: string) {
        // Extract the root prefix from the klasifikasi kode
        // Handle special case: 'TU.02' maps to 'F.VI' (kearsipan) while 'TU' maps to 'F.VII'
        const prefix = this.extractPrefix(klasifikasiKode);

        // Find mapping(s) for this prefix
        const mappings = await db
            .select()
            .from(klasifikasiJraMapping)
            .where(and(
                eq(klasifikasiJraMapping.klasifikasiPrefix, prefix),
                eq(klasifikasiJraMapping.isActive, true)
            ));

        if (mappings.length === 0) {
            // Try with only the root (first segment) if specific prefix didn't match
            const rootPrefix = klasifikasiKode.split('.')[0];
            if (rootPrefix !== prefix) {
                const rootMappings = await db
                    .select()
                    .from(klasifikasiJraMapping)
                    .where(and(
                        eq(klasifikasiJraMapping.klasifikasiPrefix, rootPrefix),
                        eq(klasifikasiJraMapping.isActive, true)
                    ));
                if (rootMappings.length > 0) {
                    return this.fetchJRAByPrefixes(rootMappings);
                }
            }
            return { mappings: [], suggestedJRA: [] };
        }

        return this.fetchJRAByPrefixes(mappings);
    }

    // Get JRA suggestions for a given mapping
    private async fetchJRAByPrefixes(mappings: any[]) {
        const allJRA: any[] = [];
        for (const mapping of mappings) {
            const jraItems = await db
                .select()
                .from(jadwalRetensiArsip)
                .where(and(
                    like(jadwalRetensiArsip.kode, `${mapping.jraPrefix}%`),
                    eq(jadwalRetensiArsip.isActive, true)
                ))
                .orderBy(jadwalRetensiArsip.kode);
            allJRA.push(...jraItems);
        }

        // Deduplicate in case multiple mappings point to the same JRA prefix
        const uniqueJRA = allJRA.filter((item, index, arr) =>
            arr.findIndex(i => i.kode === item.kode) === index
        );

        return {
            mappings: mappings.map(m => ({
                tema: m.tema,
                klasifikasiPrefix: m.klasifikasiPrefix,
                jraPrefix: m.jraPrefix,
                keterangan: m.keterangan,
            })),
            suggestedJRA: uniqueJRA,
        };
    }

    // Extract the best matching prefix from a klasifikasi kode
    private extractPrefix(kode: string): string {
        // Special case: 'TU.02' is specifically kearsipan, different from general 'TU'
        if (kode.startsWith('TU.02')) return 'TU.02';
        // Return root prefix (first segment before any dot)
        return kode.split('.')[0];
    }
}

export const mappingService = new MappingService();
export default klasifikasiService;
