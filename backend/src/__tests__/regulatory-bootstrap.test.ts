import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ results: [] as any[], writes: [] as any[] }));
const storage = vi.hoisted(() => ({ getFile: vi.fn() }));
const seedLock = vi.hoisted(() => vi.fn(async (_key, operation) => operation()));
const chain: any = new Proxy({}, {
    get(_target, property) {
        if (property === 'then') {
            return (resolve: (value: unknown) => void) => resolve(state.results.shift() ?? []);
        }
        return (value: unknown) => {
            if (property === 'set' || property === 'values') state.writes.push(value);
            return chain;
        };
    },
});
const db: any = {
    select: () => chain, insert: () => chain, update: () => chain, delete: vi.fn(() => chain),
    execute: async () => [], transaction: async (operation: any) => operation(db),
};
vi.mock('../config/database', () => ({ db }));
vi.mock('../services/blob-storage.service', () => ({ blobStorageService: storage }));
vi.mock('../services/client-blob-upload.service.js', () => ({ clientBlobUploadService: {} }));
vi.mock('../services/durable-final-object.service.js', () => ({ durableFinalObjectService: {} }));
vi.mock('../db/regulatory-seed-lock', () => ({
    REGULATORY_SEED_LOCK: { klasifikasi: 1, jra: 2 }, withRegulatorySeedLock: seedLock,
}));

const { RegulatoryRuleSetService, deterministicRegulatoryContentHash, regulatoryRuleSetService,
    validateRegulatoryRuleItems } = await import('../services/regulatory-rule-set.service');
const { regulatoryEvidenceHash } = await import('../services/regulatory-audit.service');
const { KLASIFIKASI_RULE_SET_2018_ID, JRA_RULE_SET_2020_ID } = await import('../db/schema');
const { seedKlasifikasiArsip } = await import('../db/seed-klasifikasi');
const { seedJadwalRetensiArsip } = await import('../db/seed-jra');
const classificationSeed = (await import('../db/data/klasifikasi-atr-bpn-10-2018.json')).default;
const jraSeed = (await import('../db/data/jra-atr-bpn-8-2020.json')).default;

const instruments = [
    { type: 'klasifikasi' as const, id: KLASIFIKASI_RULE_SET_2018_ID, seed: seedKlasifikasiArsip, asset: classificationSeed },
    { type: 'jra' as const, id: JRA_RULE_SET_2020_ID, seed: seedJadwalRetensiArsip, asset: jraSeed },
];
const deployedEnvironments = [
    { name: 'production', NODE_ENV: 'production', K_SERVICE: '', VERCEL: '' },
    { name: 'Cloud Run with development env', NODE_ENV: 'development', K_SERVICE: 'simsa-api', VERCEL: '' },
    { name: 'Vercel with test env', NODE_ENV: 'test', K_SERVICE: '', VERCEL: '1' },
];
function environment(source: { NODE_ENV?: string; K_SERVICE?: string; VERCEL?: string }) {
    for (const key of ['NODE_ENV', 'K_SERVICE', 'VERCEL'] as const) vi.stubEnv(key, source[key]);
}
function fixture(instrument: typeof instruments[number], approved = false) {
    const item: any = {
        ...instrument.asset.records.find((record) => record.isSelectable),
        id: 1, parentKode: null, level: 0,
    };
    item.contentHash = deterministicRegulatoryContentHash(instrument.type, [item]);
    const manifest = { expectedItemCount: 1, expectedSelectableCount: 1,
        sourcePageCount: item.sourcePage, coveredPageRanges: [{ start: 1, end: item.sourcePage }] };
    const impact = { candidateContentHash: item.contentHash, predecessorRuleSetId: null };
    const candidate: any = {
        id: instrument.id, instrumentType: instrument.type, status: approved ? 'approved' : 'draft',
        effectiveFrom: '2020-01-01', supersedesId: null, sourceDocumentSha256: 'a'.repeat(64),
        sourceDocumentVerifiedAt: new Date(), sourceDocumentMimeType: 'application/pdf',
        sourceDocumentPageCount: item.sourcePage, completenessManifest: manifest,
        completenessManifestSha256: regulatoryEvidenceHash(manifest), completenessVerifiedAt: new Date(),
        impactReport: impact, impactReportSha256: regulatoryEvidenceHash(impact), impactReportGeneratedAt: new Date(),
        ...(approved ? {
            sourceDocumentBlobUrl: `https://store.private.blob.vercel-storage.com/regulatory-sources/${instrument.id}/source.pdf`,
            sourceDocumentSizeBytes: 1000, sourceDocumentVerifiedBy: 'source-actor',
            submittedBy: 'maker', reviewedBy: 'reviewer', approvedBy: 'approver',
        } : {}),
    };
    return { candidate, item };
}
function enqueueActivation(candidate: any, item: any) {
    state.results.push([candidate], [item], [], [{ ...candidate, status: 'active' }], [], []);
}

beforeEach(() => {
    state.results.length = 0; state.writes.length = 0;
    vi.clearAllMocks();
    environment({ NODE_ENV: 'development' });
    storage.getFile.mockImplementation(async (url) => ({ url, mimeType: 'application/pdf', size: 1000 }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe.each(instruments)('$type baseline bootstrap', (instrument) => {
    it.each(deployedEnvironments)('rejects actor-less activation on $name before any mutation', async (deployed) => {
        environment(deployed);
        const { candidate, item } = fixture(instrument);
        enqueueActivation(candidate, item);
        await expect(new RegulatoryRuleSetService().activate(candidate.id)).rejects.toThrow(/mencatat superadmin.*mengesahkan/i);
        expect(state.writes).toEqual([]);
    });

    it.each(deployedEnvironments)('requires verified private source evidence on $name', async (deployed) => {
        environment(deployed);
        const { candidate, item } = fixture(instrument);
        state.results.push([candidate], [item]);
        const validation = await new RegulatoryRuleSetService().validateDraft(candidate.id);
        expect(validation.valid).toBe(false);
        expect(validation.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
            'missing_source_verifier', 'missing_source_bitstream', 'missing_source_size',
        ]));
    });

    it('rejects an unverified production draft despite having a publisher', async () => {
        environment(deployedEnvironments[0]);
        const { candidate, item } = fixture(instrument);
        enqueueActivation(candidate, item);
        await expect(new RegulatoryRuleSetService().activate(candidate.id, 'publisher'))
            .rejects.toMatchObject({ report: expect.objectContaining({
                valid: false,
                errors: expect.arrayContaining([
                    expect.objectContaining({ code: 'missing_source_verifier' }),
                    expect.objectContaining({ code: 'missing_source_bitstream' }),
                    expect.objectContaining({ code: 'missing_source_size' }),
                ]),
            }) });
        expect(state.writes).toEqual([]);
        expect(storage.getFile).not.toHaveBeenCalled();
    });

    it('checks stored source availability before activating an approved production baseline', async () => {
        environment(deployedEnvironments[0]);
        const { candidate, item } = fixture(instrument, true);
        enqueueActivation(candidate, item);
        storage.getFile.mockResolvedValue(null);
        await expect(new RegulatoryRuleSetService().activate(candidate.id, 'publisher')).rejects.toThrow(/tidak lagi tersedia/);
        expect(storage.getFile).toHaveBeenCalledWith(candidate.sourceDocumentBlobUrl, { generation: undefined });
        expect(state.writes).toEqual([]);
    });

    it.each(['draft', 'approved'])('permits verified production %s activation with a genuine publisher', async (status) => {
        environment(deployedEnvironments[0]);
        const { candidate, item } = fixture(instrument, true);
        candidate.status = status;
        if (status === 'draft') {
            candidate.submittedBy = null;
            candidate.reviewedBy = null;
            candidate.approvedBy = null;
        }
        enqueueActivation(candidate, item);
        const result = await new RegulatoryRuleSetService().activate(candidate.id, 'publisher');
        expect(result.ruleSet.status).toBe('active');
        expect(storage.getFile).toHaveBeenCalledTimes(1);
        const publication = state.writes.find(write => write.status === 'active');
        expect(publication).toMatchObject({ publishedBy: 'publisher' });
        for (const key of ['submittedBy', 'submittedAt', 'reviewedBy', 'reviewedAt', 'approvedBy', 'approvedAt']) {
            expect(publication).not.toHaveProperty(key);
        }
        expect(state.writes.at(-1)).toEqual([expect.objectContaining({
            action: 'activate', actorId: 'publisher', before: { status },
            after: expect.objectContaining({ publishedBy: 'publisher', authorizationPolicy: 'super_admin' }),
        })]);
    });

    it('rejects actor-less activation of any nonbaseline edition even in local development', async () => {
        const { candidate, item } = fixture(instrument, true);
        candidate.id = '22222222-2222-4222-8222-222222222222';
        enqueueActivation(candidate, item);
        await expect(new RegulatoryRuleSetService().activate(candidate.id))
            .rejects.toThrow(/mencatat superadmin.*mengesahkan/i);
        expect(state.writes).toEqual([]);
        expect(storage.getFile).not.toHaveBeenCalled();
    });

    it.each(['development', 'test', undefined])('preserves local %s bootstrap behavior', async (NODE_ENV) => {
        environment({ NODE_ENV });
        const { candidate, item } = fixture(instrument);
        enqueueActivation(candidate, item);
        const result = await new RegulatoryRuleSetService().activate(candidate.id);
        expect(result.validation.valid).toBe(true);
        expect(result.ruleSet.status).toBe('active');
        expect(storage.getFile).not.toHaveBeenCalled();
        expect(state.writes.at(-1)).toEqual([expect.objectContaining({ action: 'bootstrap_activate', actorId: null })]);
    });

    it.each(deployedEnvironments)('rejects automated seed on $name before locks or writes', async (deployed) => {
        environment(deployed);
        state.results.push([{ status: 'active', sourceDocumentSha256: instrument.asset.source.sha256 }]);
        await expect(instrument.seed()).rejects.toThrow(/seed|bootstrap/i);
        expect(seedLock).not.toHaveBeenCalled();
        expect(state.writes).toEqual([]);
    });

    it('seeds locally and retains published content on rerun', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const validation = validateRegulatoryRuleItems(instrument.type, instrument.asset.records);
        const impact = vi.spyOn(regulatoryRuleSetService, 'generateImpactReport').mockResolvedValue({} as any);
        const validate = vi.spyOn(regulatoryRuleSetService, 'validateDraft').mockResolvedValue(validation);
        const activate = vi.spyOn(regulatoryRuleSetService, 'activate').mockResolvedValue({} as any);
        state.results.push([{ status: 'draft', sourceDocumentSha256: instrument.asset.source.sha256 }], []);
        expect(await instrument.seed()).toMatchObject({ status: 'activated' });
        expect(impact).toHaveBeenCalledWith(instrument.id);
        expect(validate).toHaveBeenCalledWith(instrument.id);
        expect(activate).toHaveBeenCalledWith(instrument.id);
        const writeCount = state.writes.length;
        state.results.push([{ status: 'active', sourceDocumentSha256: instrument.asset.source.sha256 }]);
        expect(await instrument.seed()).toEqual({ status: 'skipped', reason: 'rule_set_active' });
        expect(state.writes).toHaveLength(writeCount);
        expect(activate).toHaveBeenCalledTimes(1);
    });
});
