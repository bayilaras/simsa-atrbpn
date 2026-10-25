import { beforeEach, describe, expect, it, vi } from 'vitest';
import classificationAsset from '../db/data/klasifikasi-atr-bpn-10-2018.json';
import jraAsset from '../db/data/jra-atr-bpn-8-2020.json';

const results = vi.hoisted(() => [] as unknown[][]);
vi.mock('../config/database', () => {
    const query: any = new Proxy({}, {
        get(_target, property) {
            if (property === 'then') {
                return (resolve: (value: unknown[]) => unknown) => resolve(results.shift() ?? []);
            }
            return () => query;
        },
    });
    return { db: { select: () => query } };
});

const { klasifikasiService, jraService } = await import('../services/klasifikasi.service');

function edition(instrumentType: 'klasifikasi' | 'jra', records: unknown[]) {
    const isClassification = instrumentType === 'klasifikasi';
    return {
        id: isClassification ? '10102018-1010-4010-8010-000000000010' : '08002020-0800-4080-8080-000000000008',
        instrumentType,
        status: 'active',
        version: isClassification ? 'ATR-BPN-10-2018' : 'ATR-BPN-8-2020',
        name: isClassification ? 'Klasifikasi Arsip ATR/BPN' : 'Jadwal Retensi Arsip ATR/BPN',
        regulationNumber: isClassification ? 'Permen ATR/BPN Nomor 10 Tahun 2018' : 'Permen ATR/BPN Nomor 8 Tahun 2020',
        legalBasis: isClassification ? 'Permen ATR/BPN Nomor 10 Tahun 2018' : 'Permen ATR/BPN Nomor 8 Tahun 2020',
        effectiveFrom: isClassification ? '2018-05-28' : '2020-06-15',
        effectiveTo: null,
        sourceDocumentSha256: isClassification ? classificationAsset.source.sha256 : jraAsset.source.sha256,
        sourceDocumentBlobUrl: 'https://fixture.private.blob.vercel-storage.com/regulatory-sources/private.pdf',
        sourceDocumentObjectGeneration: '123456',
        // A baseline impact report lists all imported items. Real publication
        // evidence must never grow the picker response once per catalog row.
        impactReport: { added: records, removed: [], changed: [], candidateContentHash: 'a'.repeat(64) },
        completenessManifest: { verificationStatement: 'Reviewed official pages. '.repeat(100) },
        metadata: {
            identifierSemantics: jraAsset.identifierSemantics,
            contentHash: 'a'.repeat(64),
            historicalEvidence: records,
        },
    };
}

function assertCompactResponse(rows: any[], ruleSet: ReturnType<typeof edition>) {
    const serialized = JSON.stringify({ success: true, data: rows });
    // Leave comfortable headroom beneath the hosting function's 4.5 MB limit.
    expect(Buffer.byteLength(serialized)).toBeLessThan(2 * 1024 * 1024);
    expect(rows[0].ruleSet).toMatchObject({
        id: ruleSet.id,
        status: 'active',
        version: ruleSet.version,
        regulationNumber: ruleSet.regulationNumber,
        legalBasis: ruleSet.legalBasis,
        sourceDocumentSha256: ruleSet.sourceDocumentSha256,
        sourceDocumentStored: true,
        metadata: { identifierSemantics: jraAsset.identifierSemantics },
    });
    expect(rows[0].version).toBe(ruleSet.version);
    expect(rows[0].reference).toBe(ruleSet.legalBasis);
    expect(serialized).not.toContain('impactReport');
    expect(serialized).not.toContain('completenessManifest');
    expect(serialized).not.toContain('historicalEvidence');
    expect(serialized).not.toContain('private.blob.vercel-storage.com');
    expect(serialized).not.toContain('sourceDocumentObjectGeneration');
    return serialized;
}

describe('catalog response size with complete official datasets', () => {
    beforeEach(() => { results.length = 0; });

    it.each(['kementerian', 'kanwil', 'kantah'] as const)('keeps every %s classification item within the payload budget', async (scope) => {
        const records = classificationAsset.records.filter(item => item.organizationalScope === scope);
        const ruleSet = edition('klasifikasi', classificationAsset.records);
        results.push([ruleSet], records);

        const rows = await klasifikasiService.getAll({ organizationalScope: scope });

        expect(rows).toHaveLength(classificationAsset.expectedCounts.byScope[scope]);
        expect(rows.map(({ ruleSet: _ruleSet, version: _version, reference: _reference, ...item }) => item)).toEqual(records);
        assertCompactResponse(rows, ruleSet);
        // Summarizing catalog rows must not mutate evidence used by governance.
        expect(ruleSet.impactReport.added).toBe(classificationAsset.records);
        expect(ruleSet.metadata.historicalEvidence).toBe(classificationAsset.records);
    });

    it('keeps all 545 JRA items and 391 selectable rules within the payload budget', async () => {
        const ruleSet = edition('jra', jraAsset.records);
        results.push([ruleSet], jraAsset.records);

        const rows = await jraService.getAll();

        expect(rows).toHaveLength(jraAsset.expectedCounts.records);
        expect(rows.filter(row => row.isSelectable)).toHaveLength(jraAsset.expectedCounts.selectable);
        expect(rows.map(({ ruleSet: _ruleSet, version: _version, reference: _reference, ...item }) => item)).toEqual(jraAsset.records);
        assertCompactResponse(rows, ruleSet);
        expect(ruleSet.completenessManifest.verificationStatement.length).toBeGreaterThan(1000);
    });

    it.each([null, { nested: 'unbounded' }, 'x'.repeat(1001)])('omits noncompact identifier metadata without changing the stored edition', async (identifierSemantics) => {
        const ruleSet = edition('jra', jraAsset.records);
        Object.assign(ruleSet.metadata, { identifierSemantics });
        results.push([ruleSet], jraAsset.records);

        const rows = await jraService.getAll();

        expect(rows[0].ruleSet.metadata).toEqual({});
        expect(Buffer.byteLength(JSON.stringify(rows))).toBeLessThan(2 * 1024 * 1024);
        expect(ruleSet.metadata.identifierSemantics).toEqual(identifierSemantics);
    });
});
