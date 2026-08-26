import { db } from '../config/database';
import {
    klasifikasiArsip,
    jadwalRetensiArsip,
    NewKlasifikasiArsip,
    NewJadwalRetensiArsip,
    klasifikasiJraMapping,
    regulatoryRuleSets,
} from '../db/schema';
import { eq, and, like, or } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '../utils/errors';

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
    isSelectable: boolean;
    ruleSet?: any;
    children?: KlasifikasiTreeNode[];
}

function buildTree(items: KlasifikasiTreeNode[], parentKode: string | null = null): KlasifikasiTreeNode[] {
    return items
        .filter(item => item.parentKode === parentKode)
        .map(item => ({ ...item, children: buildTree(items, item.kode) }));
}

async function resolveRuleSet(instrumentType: 'klasifikasi' | 'jra', ruleSetId?: string) {
    const conditions = [eq(regulatoryRuleSets.instrumentType, instrumentType)];
    if (ruleSetId) conditions.push(eq(regulatoryRuleSets.id, ruleSetId));
    else conditions.push(eq(regulatoryRuleSets.status, 'active'));
    const [ruleSet] = await db.select().from(regulatoryRuleSets).where(and(...conditions)).limit(1);
    if (!ruleSet) throw new NotFoundError(`Versi ${instrumentType}`);
    return ruleSet;
}

async function assertDraft(ruleSetId: string | undefined, instrumentType: 'klasifikasi' | 'jra') {
    const ruleSet = await resolveRuleSet(instrumentType, ruleSetId);
    if (ruleSet.status !== 'draft') {
        throw new ConflictError('Versi yang sudah dipublikasikan bersifat immutable. Buat atau kloning versi draft terlebih dahulu.');
    }
    return ruleSet;
}

function withRuleSet<T extends Record<string, any>>(rows: T[], ruleSet: any) {
    return rows.map(row => ({
        ...row,
        version: ruleSet.version,
        reference: ruleSet.legalBasis,
        ruleSet,
    }));
}

class KlasifikasiService {
    async getAll(filters: {
        tipe?: string;
        search?: string;
        activeOnly?: boolean;
        ruleSetId?: string;
        organizationalScope?: 'kementerian' | 'kanwil' | 'kantah';
    } = {}) {
        const ruleSet = await resolveRuleSet('klasifikasi', filters.ruleSetId);
        const conditions = [
            eq(klasifikasiArsip.ruleSetId, ruleSet.id),
            eq(klasifikasiArsip.organizationalScope, filters.organizationalScope || 'kementerian'),
        ];
        if (filters.tipe) conditions.push(eq(klasifikasiArsip.tipe, filters.tipe));
        if (filters.activeOnly !== false) conditions.push(eq(klasifikasiArsip.isActive, true));
        if (filters.search) {
            conditions.push(or(
                like(klasifikasiArsip.kode, `%${filters.search}%`),
                like(klasifikasiArsip.jenis, `%${filters.search}%`),
            )!);
        }
        const rows = await db.select().from(klasifikasiArsip)
            .where(and(...conditions)).orderBy(klasifikasiArsip.kode);
        return withRuleSet(rows, ruleSet);
    }

    async getTree(
        tipe?: string,
        ruleSetId?: string,
        organizationalScope: 'kementerian' | 'kanwil' | 'kantah' = 'kementerian',
    ) {
        const flatData = await this.getAll({ tipe, ruleSetId, organizationalScope, activeOnly: true });
        return buildTree(flatData as KlasifikasiTreeNode[], null);
    }

    async getByKode(
        kode: string,
        ruleSetId?: string,
        organizationalScope: 'kementerian' | 'kanwil' | 'kantah' = 'kementerian',
    ) {
        const ruleSet = await resolveRuleSet('klasifikasi', ruleSetId);
        const matches = await db.select().from(klasifikasiArsip).where(and(
            eq(klasifikasiArsip.ruleSetId, ruleSet.id),
            eq(klasifikasiArsip.organizationalScope, organizationalScope),
            eq(klasifikasiArsip.kode, kode),
        )).limit(2);
        if (matches.length > 1) {
            throw new ConflictError('Kode klasifikasi tidak unik pada lingkup ini. Gunakan ID/source record butir resmi.');
        }
        const [item] = matches;
        return item ? withRuleSet([item], ruleSet)[0] : null;
    }

    async getChildren(
        parentKode: string,
        ruleSetId?: string,
        organizationalScope: 'kementerian' | 'kanwil' | 'kantah' = 'kementerian',
    ) {
        const ruleSet = await resolveRuleSet('klasifikasi', ruleSetId);
        const rows = await db.select().from(klasifikasiArsip).where(and(
            eq(klasifikasiArsip.ruleSetId, ruleSet.id),
            eq(klasifikasiArsip.organizationalScope, organizationalScope),
            eq(klasifikasiArsip.parentKode, parentKode),
            eq(klasifikasiArsip.isActive, true),
        )).orderBy(klasifikasiArsip.kode);
        return withRuleSet(rows, ruleSet);
    }

    async create(data: NewKlasifikasiArsip) {
        const ruleSet = await assertDraft(data.ruleSetId, 'klasifikasi');
        const [created] = await db.insert(klasifikasiArsip)
            .values({ ...data, ruleSetId: ruleSet.id }).returning();
        return withRuleSet([created], ruleSet)[0];
    }

    async updateById(id: number, data: Partial<NewKlasifikasiArsip>) {
        const ruleSet = await assertDraft(data.ruleSetId, 'klasifikasi');
        const [updated] = await db.update(klasifikasiArsip)
            .set({ ...data, ruleSetId: ruleSet.id, contentHash: null, updatedAt: new Date() })
            .where(and(eq(klasifikasiArsip.id, id), eq(klasifikasiArsip.ruleSetId, ruleSet.id)))
            .returning();
        return updated ? withRuleSet([updated], ruleSet)[0] : null;
    }

    async update(kode: string, data: Partial<NewKlasifikasiArsip>) {
        const ruleSet = await assertDraft(data.ruleSetId, 'klasifikasi');
        const [updated] = await db.update(klasifikasiArsip)
            .set({ ...data, ruleSetId: ruleSet.id, updatedAt: new Date() })
            .where(and(eq(klasifikasiArsip.ruleSetId, ruleSet.id), eq(klasifikasiArsip.kode, kode)))
            .returning();
        return updated ? withRuleSet([updated], ruleSet)[0] : null;
    }

    async delete(kode: string, ruleSetId?: string) {
        const ruleSet = await assertDraft(ruleSetId, 'klasifikasi');
        const [deleted] = await db.update(klasifikasiArsip)
            .set({ isActive: false, updatedAt: new Date() })
            .where(and(eq(klasifikasiArsip.ruleSetId, ruleSet.id), eq(klasifikasiArsip.kode, kode)))
            .returning();
        return deleted ? withRuleSet([deleted], ruleSet)[0] : null;
    }

    async deleteById(id: number, ruleSetId?: string) {
        const ruleSet = await assertDraft(ruleSetId, 'klasifikasi');
        const [deleted] = await db.update(klasifikasiArsip)
            .set({ isActive: false, isSelectable: false, contentHash: null, updatedAt: new Date() })
            .where(and(eq(klasifikasiArsip.id, id), eq(klasifikasiArsip.ruleSetId, ruleSet.id)))
            .returning();
        return deleted ? withRuleSet([deleted], ruleSet)[0] : null;
    }

    async getStats(ruleSetId?: string) {
        const all = await this.getAll({ ruleSetId, activeOnly: true });
        const fasilitatif = all.filter(i => i.tipe === 'fasilitatif');
        const substantif = all.filter(i => i.tipe === 'substantif');
        return {
            total: all.length,
            fasilitatif: fasilitatif.length,
            substantif: substantif.length,
            rootFasilitatif: fasilitatif.filter(i => i.level === 0).length,
            rootSubstantif: substantif.filter(i => i.level === 0).length,
            ruleSet: all[0]?.ruleSet || await resolveRuleSet('klasifikasi', ruleSetId),
        };
    }
}

class JRAService {
    async getAll(filters: { tipe?: string; search?: string; activeOnly?: boolean; ruleSetId?: string } = {}) {
        const ruleSet = await resolveRuleSet('jra', filters.ruleSetId);
        const conditions = [eq(jadwalRetensiArsip.ruleSetId, ruleSet.id)];
        if (filters.tipe) conditions.push(eq(jadwalRetensiArsip.tipe, filters.tipe));
        if (filters.activeOnly !== false) conditions.push(eq(jadwalRetensiArsip.isActive, true));
        if (filters.search) {
            conditions.push(or(
                like(jadwalRetensiArsip.kode, `%${filters.search}%`),
                like(jadwalRetensiArsip.uraian, `%${filters.search}%`),
            )!);
        }
        const rows = await db.select().from(jadwalRetensiArsip)
            .where(and(...conditions)).orderBy(jadwalRetensiArsip.kode);
        return withRuleSet(rows, ruleSet);
    }

    async getTree(tipe?: string, ruleSetId?: string) {
        const flatData = await this.getAll({ tipe, ruleSetId, activeOnly: true });
        const buildJRATree = (items: any[], parentKode: string | null = null): any[] => items
            .filter(item => item.parentKode === parentKode)
            .map(item => ({ ...item, children: buildJRATree(items, item.kode) }));
        return buildJRATree(flatData, null);
    }

    async getByKode(kode: string, ruleSetId?: string) {
        const ruleSet = await resolveRuleSet('jra', ruleSetId);
        const [item] = await db.select().from(jadwalRetensiArsip).where(and(
            eq(jadwalRetensiArsip.ruleSetId, ruleSet.id),
            eq(jadwalRetensiArsip.kode, kode),
        )).limit(1);
        return item ? withRuleSet([item], ruleSet)[0] : null;
    }

    async create(data: NewJadwalRetensiArsip) {
        const ruleSet = await assertDraft(data.ruleSetId, 'jra');
        const [created] = await db.insert(jadwalRetensiArsip)
            .values({ ...data, ruleSetId: ruleSet.id }).returning();
        return withRuleSet([created], ruleSet)[0];
    }

    async updateById(id: number, data: Partial<NewJadwalRetensiArsip>) {
        const ruleSet = await assertDraft(data.ruleSetId, 'jra');
        const [updated] = await db.update(jadwalRetensiArsip)
            .set({ ...data, ruleSetId: ruleSet.id, contentHash: null, updatedAt: new Date() })
            .where(and(eq(jadwalRetensiArsip.id, id), eq(jadwalRetensiArsip.ruleSetId, ruleSet.id)))
            .returning();
        return updated ? withRuleSet([updated], ruleSet)[0] : null;
    }

    async update(kode: string, data: Partial<NewJadwalRetensiArsip>) {
        const ruleSet = await assertDraft(data.ruleSetId, 'jra');
        const [updated] = await db.update(jadwalRetensiArsip)
            .set({ ...data, ruleSetId: ruleSet.id, updatedAt: new Date() })
            .where(and(eq(jadwalRetensiArsip.ruleSetId, ruleSet.id), eq(jadwalRetensiArsip.kode, kode)))
            .returning();
        return updated ? withRuleSet([updated], ruleSet)[0] : null;
    }

    async delete(kode: string, ruleSetId?: string) {
        const ruleSet = await assertDraft(ruleSetId, 'jra');
        const [deleted] = await db.update(jadwalRetensiArsip)
            .set({ isActive: false, updatedAt: new Date() })
            .where(and(eq(jadwalRetensiArsip.ruleSetId, ruleSet.id), eq(jadwalRetensiArsip.kode, kode)))
            .returning();
        return deleted ? withRuleSet([deleted], ruleSet)[0] : null;
    }

    async deleteById(id: number, ruleSetId?: string) {
        const ruleSet = await assertDraft(ruleSetId, 'jra');
        const [deleted] = await db.update(jadwalRetensiArsip)
            .set({ isActive: false, isSelectable: false, contentHash: null, updatedAt: new Date() })
            .where(and(eq(jadwalRetensiArsip.id, id), eq(jadwalRetensiArsip.ruleSetId, ruleSet.id)))
            .returning();
        return deleted ? withRuleSet([deleted], ruleSet)[0] : null;
    }
}

export const klasifikasiService = new KlasifikasiService();
export const jraService = new JRAService();

class MappingService {
    private async activeRuleSets() {
        const [classification, retention] = await Promise.all([
            resolveRuleSet('klasifikasi'),
            resolveRuleSet('jra'),
        ]);
        return { classification, retention };
    }

    async getAllMappings() {
        const { classification, retention } = await this.activeRuleSets();
        return db.select().from(klasifikasiJraMapping).where(and(
            eq(klasifikasiJraMapping.klasifikasiRuleSetId, classification.id),
            eq(klasifikasiJraMapping.jraRuleSetId, retention.id),
            eq(klasifikasiJraMapping.isActive, true),
        )).orderBy(klasifikasiJraMapping.tema);
    }

    async getSuggestedJRA(klasifikasiKode: string) {
        const { classification, retention } = await this.activeRuleSets();
        const prefix = this.extractPrefix(klasifikasiKode);
        const lookup = async (candidate: string) => db.select().from(klasifikasiJraMapping).where(and(
            eq(klasifikasiJraMapping.klasifikasiRuleSetId, classification.id),
            eq(klasifikasiJraMapping.jraRuleSetId, retention.id),
            eq(klasifikasiJraMapping.klasifikasiPrefix, candidate),
            eq(klasifikasiJraMapping.isActive, true),
        ));
        let mappings = await lookup(prefix);
        const rootPrefix = klasifikasiKode.split('.')[0];
        if (mappings.length === 0 && rootPrefix !== prefix) mappings = await lookup(rootPrefix);
        if (mappings.length === 0) return { mappings: [], suggestedJRA: [] };
        return this.fetchJRAByPrefixes(mappings, retention);
    }

    private async fetchJRAByPrefixes(mappings: any[], ruleSet: any) {
        const allJRA: any[] = [];
        for (const mapping of mappings) {
            const rows = await db.select().from(jadwalRetensiArsip).where(and(
                eq(jadwalRetensiArsip.ruleSetId, ruleSet.id),
                // Prefixes represent complete code segments. Without the dot
                // boundary, the S.VI recommendation also returned S.VII,
                // which could lead an archivist to select an unrelated JRA.
                or(
                    eq(jadwalRetensiArsip.kode, mapping.jraPrefix),
                    like(jadwalRetensiArsip.kode, `${mapping.jraPrefix}.%`),
                ),
                eq(jadwalRetensiArsip.isActive, true),
            )).orderBy(jadwalRetensiArsip.kode);
            allJRA.push(...withRuleSet(rows, ruleSet));
        }
        const uniqueJRA = allJRA.filter((item, index, values) =>
            values.findIndex(candidate => candidate.id === item.id) === index,
        );
        return {
            mappings: mappings.map(mapping => ({
                tema: mapping.tema,
                klasifikasiPrefix: mapping.klasifikasiPrefix,
                jraPrefix: mapping.jraPrefix,
                keterangan: mapping.keterangan,
            })),
            suggestedJRA: uniqueJRA,
        };
    }

    private extractPrefix(kode: string): string {
        if (kode.startsWith('TU.02')) return 'TU.02';
        return kode.split('.')[0];
    }
}

export const mappingService = new MappingService();
export default klasifikasiService;
