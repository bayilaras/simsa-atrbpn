import { beforeEach, describe, expect, it, vi } from 'vitest';

const resultQueue: any[] = [];
const capturedSets: any[] = [];
const capturedValues: any[] = [];

function enqueue(...results: any[]) {
    resultQueue.push(...results);
}

const mockChain: any = new Proxy({}, {
    get(_target, property) {
        if (property === 'then') {
            const value = resultQueue.shift() ?? [];
            return (resolve: (result: any) => void) => resolve(value);
        }
        return (argument?: any) => {
            if (property === 'set') capturedSets.push(argument);
            if (property === 'values') capturedValues.push(argument);
            return mockChain;
        };
    },
});

const mockDb: any = {
    select: () => mockChain,
    insert: () => mockChain,
    update: () => mockChain,
    delete: () => mockChain,
    transaction: async (work: (tx: any) => Promise<any>) => work(mockDb),
};

vi.mock('../config/database', () => ({ db: mockDb }));

const {
    RegulatoryRuleSetService,
    deterministicRegulatoryContentHash,
    validateRegulatoryRuleItems,
} = await import('../services/regulatory-rule-set.service');

const classificationLeaf = {
    kode: 'KU.01',
    sourceCode: 'KU.01',
    sourceRecordKey: 'atr10-2018:kementerian:0001',
    organizationalScope: 'kementerian',
    jenis: 'Keuangan',
    keterangan: 'Berkas anggaran',
    kategori: 'KEUANGAN',
    parentKode: null,
    tipe: 'fasilitatif',
    level: 0,
    isActive: true,
    isSelectable: true,
    sourcePage: 1,
};

describe('regulatory rule-set pure policy', () => {
    it('produces deterministic SHA-256 independent of item order and volatile fields', () => {
        const first = { ...classificationLeaf, id: 10, createdAt: new Date('2020-01-01') };
        const second = {
            ...classificationLeaf,
            kode: 'KU.02',
            jenis: 'Perbendaharaan',
            id: 20,
            updatedAt: new Date('2025-01-01'),
        };

        const hashA = deterministicRegulatoryContentHash('klasifikasi', [first, second]);
        const hashB = deterministicRegulatoryContentHash('klasifikasi', [
            { ...second, id: 999 },
            { ...first, id: 888 },
        ]);
        const changed = deterministicRegulatoryContentHash('klasifikasi', [
            first,
            { ...second, jenis: 'Perbendaharaan berubah' },
        ]);

        expect(hashA).toMatch(/^[0-9a-f]{64}$/);
        expect(hashB).toBe(hashA);
        expect(changed).not.toBe(hashA);
    });

    it('rejects orphaned, cyclic, and selectable parent nodes', () => {
        const report = validateRegulatoryRuleItems('klasifikasi', [
            { ...classificationLeaf, kode: 'A', sourceRecordKey: 'row-a', parentKode: 'B', level: 1 },
            { ...classificationLeaf, kode: 'B', sourceRecordKey: 'row-b', parentKode: 'A', level: 1 },
            { ...classificationLeaf, kode: 'ORPHAN', sourceRecordKey: 'row-orphan', parentKode: 'MISSING', level: 1 },
        ]);

        expect(report.valid).toBe(false);
        expect(report.errors.map((issue: any) => issue.code)).toEqual(expect.arrayContaining([
            'hierarchy_cycle',
            'missing_parent',
            'selectable_parent',
        ]));
    });

    it('allows duplicate printed classification codes only with distinct source identities', () => {
        const report = validateRegulatoryRuleItems('klasifikasi', [
            classificationLeaf,
            {
                ...classificationLeaf,
                sourceRecordKey: 'atr10-2018:kementerian:0002',
                jenis: 'Jadwal Retensi Arsip',
            },
        ]);

        expect(report.valid).toBe(true);
        expect(report.stats.total).toBe(2);

        const duplicateIdentity = validateRegulatoryRuleItems('klasifikasi', [
            classificationLeaf,
            { ...classificationLeaf, jenis: 'Baris sumber lain' },
        ]);
        expect(duplicateIdentity.errors.map((issue: any) => issue.code))
            .toContain('duplicate_source_record_key');
    });

    it('requires source identities only for classification and keeps JRA codes unique', () => {
        const missingClassificationIdentity = validateRegulatoryRuleItems('klasifikasi', [{
            ...classificationLeaf,
            sourceRecordKey: undefined,
        }]);
        expect(missingClassificationIdentity.errors.map((issue: any) => issue.code))
            .toContain('blank_source_record_key');

        const jraItem = {
            kode: 'F.I.1',
            uraian: 'Dokumen anggaran',
            parentKode: null,
            tipe: 'fasilitatif',
            level: 0,
            isActive: true,
            isSelectable: true,
            activeMonths: 24,
            inactiveMonths: 36,
            calculationMode: 'duration',
            dispositionCode: 'musnah',
        };
        expect(validateRegulatoryRuleItems('jra', [jraItem]).valid).toBe(true);

        const duplicateJra = validateRegulatoryRuleItems('jra', [jraItem, { ...jraItem }]);
        expect(duplicateJra.errors.map((issue: any) => issue.code)).toContain('duplicate_code');
    });

    it('validates selectable duration JRA and rejects an unsafe duration', () => {
        const validItem = {
            kode: 'F.I.1',
            uraian: 'Dokumen anggaran',
            retensiAktif: '2 tahun',
            retensiInaktif: '3 tahun',
            keterangan: 'Musnah',
            kategori: 'Fasilitatif',
            parentKode: null,
            tipe: 'fasilitatif',
            level: 0,
            isActive: true,
            isSelectable: true,
            activeMonths: 24,
            inactiveMonths: 36,
            calculationMode: 'duration',
            dispositionCode: 'musnah',
            triggerGuidance: 'Setelah kegiatan selesai',
            sourcePage: 1,
        };

        expect(validateRegulatoryRuleItems('jra', [validItem]).valid).toBe(true);
        const unsafe = validateRegulatoryRuleItems('jra', [{
            ...validItem,
            activeMonths: null,
            inactiveMonths: 0,
        }]);
        expect(unsafe.errors.map((issue: any) => issue.code)).toContain('invalid_duration');
    });
});

describe('RegulatoryRuleSetService lifecycle', () => {
    let service: InstanceType<typeof RegulatoryRuleSetService>;

    beforeEach(() => {
        resultQueue.length = 0;
        capturedSets.length = 0;
        capturedValues.length = 0;
        service = new RegulatoryRuleSetService();
    });

    it('clones the active edition and all items into an isolated draft', async () => {
        const active = {
            id: '10102018-1010-4010-8010-000000000010',
            instrumentType: 'klasifikasi',
            version: '2018.1',
            name: 'Klasifikasi 2018',
            legalBasis: 'Permen 10/2018',
            regulationNumber: '10/2018',
            sourceDocumentName: 'permen.pdf',
            sourceDocumentSha256: 'a'.repeat(64),
            sourceUrl: null,
            status: 'active',
            effectiveFrom: '2018-01-01',
            effectiveTo: null,
            supersedesId: null,
            changeSummary: null,
            metadata: { contentHash: 'old' },
            publishedAt: new Date(),
            publishedBy: null,
            createdBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const draft = {
            ...active,
            id: '22222222-2222-4222-8222-222222222222',
            version: '2026.1',
            status: 'draft',
            effectiveFrom: '2026-08-01',
            supersedesId: active.id,
            metadata: {},
        };
        enqueue([active], [draft], [classificationLeaf], []);

        const result = await service.cloneActive('klasifikasi', {
            version: '2026.1',
            effectiveFrom: '2026-08-01',
            changeSummary: 'Penyesuaian nomenklatur',
        }, 'user-1');

        expect(result.ruleSet.status).toBe('draft');
        expect(result.itemCount).toBe(1);
        expect(capturedValues[0]).toMatchObject({
            instrumentType: 'klasifikasi',
            version: '2026.1',
            status: 'draft',
            supersedesId: active.id,
            createdBy: 'user-1',
        });
        expect(capturedValues[1][0]).toMatchObject({
            ruleSetId: draft.id,
            kode: classificationLeaf.kode,
        });
        expect(capturedValues[1][0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('supersedes the current edition and activates a validated draft atomically', async () => {
        const candidate = {
            id: '22222222-2222-4222-8222-222222222222',
            instrumentType: 'klasifikasi',
            version: '2026.1',
            name: 'Klasifikasi 2026',
            legalBasis: 'Peraturan baru',
            regulationNumber: '1/2026',
            sourceDocumentName: 'aturan.pdf',
            sourceDocumentSha256: 'b'.repeat(64),
            sourceUrl: null,
            status: 'draft',
            effectiveFrom: '2026-01-01',
            effectiveTo: null,
            supersedesId: '11111111-1111-4111-8111-111111111111',
            changeSummary: null,
            metadata: {},
            publishedAt: null,
            publishedBy: null,
            createdBy: 'user-1',
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const current = {
            ...candidate,
            id: candidate.supersedesId,
            version: '2018.1',
            status: 'active',
            effectiveFrom: '2018-01-01',
            supersedesId: null,
        };
        const superseded = { ...current, status: 'superseded', effectiveTo: '2025-12-31' };
        const activated = { ...candidate, status: 'active', publishedBy: 'user-2' };
        enqueue([candidate], [classificationLeaf], [], [current], [superseded], [activated]);

        const result = await service.activate(candidate.id, 'user-2');

        expect(result.supersededRuleSet?.id).toBe(current.id);
        expect(result.validation.valid).toBe(true);
        expect(capturedSets[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(capturedSets[1]).toMatchObject({
            status: 'superseded',
            effectiveTo: '2025-12-31',
        });
        expect(capturedSets[2].status).toBe('active');
        expect(capturedSets[2].publishedBy).toBe('user-2');
        expect(capturedSets[2].metadata.contentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(capturedSets[2].metadata.contentHashAlgorithm).toBe('sha256');
    });

    it('replaces only a draft manifest after validating it in full', async () => {
        const draft = {
            id: '22222222-2222-4222-8222-222222222222',
            instrumentType: 'klasifikasi',
            status: 'draft',
            version: '2026.1',
            metadata: { expectedItemCount: 1, expectedSelectableCount: 1 },
        };
        enqueue([draft], [], []);

        const result = await service.replaceDraftItems(draft.id, {
            items: [classificationLeaf],
        } as any);

        expect(result.imported).toBe(1);
        expect(result.validation.valid).toBe(true);
        expect(capturedValues[0][0]).toMatchObject({
            ruleSetId: draft.id,
            kode: classificationLeaf.kode,
            sourceRecordKey: classificationLeaf.sourceRecordKey,
        });
        expect(capturedValues[0][0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('does not consider a draft publishable without its source-document hash', async () => {
        const draft = {
            id: '22222222-2222-4222-8222-222222222222',
            instrumentType: 'klasifikasi',
            status: 'draft',
            metadata: { expectedItemCount: 1, expectedSelectableCount: 1 },
            sourceDocumentSha256: null,
        };
        enqueue([draft], [classificationLeaf]);

        const report = await service.validateDraft(draft.id);

        expect(report.valid).toBe(false);
        expect(report.errors.map((issue: any) => issue.code)).toContain('missing_source_hash');
    });

    it('refuses to activate an already-published immutable edition', async () => {
        enqueue([{
            id: '11111111-1111-4111-8111-111111111111',
            instrumentType: 'klasifikasi',
            status: 'active',
        }]);

        await expect(service.activate('11111111-1111-4111-8111-111111111111', 'user-1'))
            .rejects.toThrow(/immutable/i);
        expect(capturedSets).toHaveLength(0);
    });
});
