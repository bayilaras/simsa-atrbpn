import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import PDFDocument from 'pdfkit';

const resultQueue: any[] = [];
const capturedSets: any[] = [];
const capturedValues: any[] = [];
const blobStorageMocks = vi.hoisted(() => ({
    uploadFile: vi.fn(),
    uploadUntrustedFile: vi.fn(),
    copyFile: vi.fn(),
    getFile: vi.fn(),
    downloadFile: vi.fn(),
    deleteFile: vi.fn(),
    deleteFileGeneration: vi.fn(),
}));
const clientBlobMocks = vi.hoisted(() => ({
    claimWithExecutor: vi.fn(),
    preAuthorizeClaim: vi.fn(),
}));
const durableFinalMocks = vi.hoisted(() => ({
    copy: vi.fn(),
    markReferenced: vi.fn(),
    compensate: vi.fn(),
}));

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
    execute: async () => [],
    transaction: async (work: (tx: any) => Promise<any>) => work(mockDb),
};

vi.mock('../config/database', () => ({ db: mockDb }));
vi.mock('../services/blob-storage.service', () => ({
    blobStorageService: blobStorageMocks,
}));
vi.mock('../services/client-blob-upload.service.js', () => ({
    clientBlobUploadService: clientBlobMocks,
}));
vi.mock('../services/durable-final-object.service.js', () => ({
    durableFinalObjectService: durableFinalMocks,
}));

const {
    RegulatoryRuleSetService,
    assertRegulatorySourceBlobLocator,
    assertRegulatorySourceObjectGeneration,
    buildRegulatoryDiff,
    deterministicRegulatoryContentHash,
    validateRegulatoryRuleItems,
} = await import('../services/regulatory-rule-set.service');
const { regulatoryEvidenceHash } = await import('../services/regulatory-audit.service');

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

async function onePagePdf(): Promise<Buffer> {
    const document = new PDFDocument({ size: 'A4' });
    const chunks: Buffer[] = [];
    document.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    const completed = new Promise<Buffer>((resolve, reject) => {
        document.on('end', () => resolve(Buffer.concat(chunks)));
        document.on('error', reject);
    });
    document.text('Peraturan sumber untuk uji verifikasi server.');
    document.end();
    return completed;
}

describe('regulatory rule-set pure policy', () => {
    it('accepts only private Blob locators bound to the same rule-set namespace', () => {
        const id = '22222222-2222-4222-8222-222222222222';
        const valid = `https://store.private.blob.vercel-storage.com/regulatory-sources/${id}/source-a.pdf`;
        expect(assertRegulatorySourceBlobLocator(id, valid)).toBe(valid);
        expect(() => assertRegulatorySourceBlobLocator(
            id,
            `https://store.blob.vercel-storage.com/regulatory-sources/${id}/source-a.pdf`,
        )).toThrow(/penyimpanan privat/i);
        expect(() => assertRegulatorySourceBlobLocator(
            id,
            'https://store.private.blob.vercel-storage.com/regulatory-sources/33333333-3333-4333-8333-333333333333/source-a.pdf',
        )).toThrow(/tidak terikat/i);
        expect(() => assertRegulatorySourceBlobLocator(id, `${valid}?download=1`))
            .toThrow(/tanpa URL akses sementara/i);
    });

    it('accepts only a canonical GCS regulatory source bound to the same rule set', () => {
        const id = '22222222-2222-4222-8222-222222222222';
        const valid = `gs://simsa-preview-upload/regulatory-sources/${id}/upload-source.pdf`;

        expect(assertRegulatorySourceBlobLocator(id, valid)).toBe(valid);
        expect(() => assertRegulatorySourceBlobLocator(
            id,
            'gs://simsa-preview-upload/regulatory-sources/33333333-3333-4333-8333-333333333333/upload-source.pdf',
        )).toThrow(/tidak valid|tidak terikat/i);
        expect(() => assertRegulatorySourceBlobLocator(
            id,
            `gs://simsa-preview-upload/regulatory-sources/${id}/nested/upload-source.pdf`,
        )).toThrow(/tidak valid|tidak terikat/i);
    });

    it('requires an exact numeric generation only for GCS regulatory sources', () => {
        expect(assertRegulatorySourceObjectGeneration('gs://simsa-upload/source.pdf', '12345'))
            .toBe('12345');
        expect(() => assertRegulatorySourceObjectGeneration('gs://simsa-upload/source.pdf', null))
            .toThrow(/Generasi immutable/);
        expect(assertRegulatorySourceObjectGeneration(
            'https://store.private.blob.vercel-storage.com/source.pdf',
            null,
        )).toBeUndefined();
    });

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

    it('produces an item-level diff suitable for activation impact review', () => {
        const diff = buildRegulatoryDiff('klasifikasi', [
            { ...classificationLeaf, id: 10, jenis: 'Keuangan diperbarui' },
            { ...classificationLeaf, id: 11, sourceRecordKey: 'new-row', kode: 'KU.02' },
        ], [
            { ...classificationLeaf, id: 1 },
            { ...classificationLeaf, id: 2, sourceRecordKey: 'removed-row', kode: 'KU.03' },
        ]);

        expect(diff.changed).toHaveLength(1);
        expect(diff.changed[0].changedFields).toContain('jenis');
        expect(diff.added.map((item: any) => item.identity)).toContain('new-row');
        expect(diff.removed.map((item: any) => item.identity)).toContain('removed-row');
    });
});

describe('RegulatoryRuleSetService lifecycle', () => {
    let service: InstanceType<typeof RegulatoryRuleSetService>;

    beforeEach(() => {
        resultQueue.length = 0;
        capturedSets.length = 0;
        capturedValues.length = 0;
        vi.clearAllMocks();
        blobStorageMocks.copyFile.mockImplementation(async ({ folder, fileName }: any) => ({
            url: `https://store.private.blob.vercel-storage.com/${folder}/copied-${fileName}`,
            name: fileName,
            mimeType: 'application/pdf',
            size: 4096,
        }));
        blobStorageMocks.getFile.mockImplementation(async (url: string) => ({
            url,
            name: 'aturan.pdf',
            mimeType: 'application/pdf',
            size: 1000,
        }));
        blobStorageMocks.deleteFile.mockResolvedValue(true);
        blobStorageMocks.deleteFileGeneration.mockResolvedValue(true);
        blobStorageMocks.uploadUntrustedFile.mockReset();
        clientBlobMocks.claimWithExecutor.mockReset();
        clientBlobMocks.claimWithExecutor.mockResolvedValue({ id: 'lease-1', status: 'claimed' });
        clientBlobMocks.preAuthorizeClaim.mockResolvedValue({
            id: 'lease-1',
            status: 'pending',
            objectGeneration: null,
        });
        durableFinalMocks.copy.mockImplementation(async (_ownerId: string, options: any) => {
            const stored = await blobStorageMocks.copyFile(options);
            return {
                stored,
                candidate: String(stored.url).startsWith('gs://') ? {
                    provider: 'gcs',
                    ownerId: _ownerId,
                    cleanupToken: '44444444-4444-4444-8444-444444444444',
                    locator: stored.url,
                    generation: stored.generation,
                } : null,
            };
        });
        durableFinalMocks.markReferenced.mockResolvedValue(undefined);
        durableFinalMocks.compensate.mockImplementation(async (write: any) => {
            if (write && !write.candidate) await blobStorageMocks.deleteFile(write.stored.url);
        });
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
            sourceDocumentBlobUrl: 'https://store.private.blob.vercel-storage.com/regulatory-sources/10102018-1010-4010-8010-000000000010/permen-old.pdf',
            sourceDocumentMimeType: 'application/pdf',
            sourceDocumentSizeBytes: 4096,
            sourceDocumentPageCount: 20,
            sourceDocumentVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
            sourceDocumentVerifiedBy: '33333333-3333-4333-8333-333333333333',
            sourceUrl: 'https://jdih.example.go.id/permen.pdf',
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
            sourceDocumentName: null,
            sourceDocumentSha256: null,
            sourceDocumentMimeType: null,
            sourceDocumentVerifiedAt: null,
            sourceUrl: null,
        });
        expect(capturedValues[1][0]).toMatchObject({
            ruleSetId: draft.id,
            kode: classificationLeaf.kode,
        });
        expect(capturedValues[1][0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('reuses complete source verification only when explicitly requested', async () => {
        const verifiedAt = new Date('2026-01-01T00:00:00.000Z');
        const sourcePdf = await onePagePdf();
        const sourceSha256 = createHash('sha256').update(sourcePdf).digest('hex');
        const active = {
            id: '10102018-1010-4010-8010-000000000010',
            instrumentType: 'klasifikasi',
            version: '2018.1',
            name: 'Klasifikasi 2018',
            legalBasis: 'Permen 10/2018',
            regulationNumber: '10/2018',
            sourceDocumentName: 'permen.pdf',
            sourceDocumentSha256: sourceSha256,
            sourceDocumentBlobUrl: 'https://store.private.blob.vercel-storage.com/regulatory-sources/10102018-1010-4010-8010-000000000010/permen-old.pdf',
            sourceDocumentMimeType: 'application/pdf',
            sourceDocumentSizeBytes: sourcePdf.length,
            sourceDocumentPageCount: 1,
            sourceDocumentVerifiedAt: verifiedAt,
            sourceDocumentVerifiedBy: '33333333-3333-4333-8333-333333333333',
            sourceUrl: 'https://jdih.example.go.id/permen.pdf',
            status: 'active',
            effectiveFrom: '2018-01-01',
            effectiveTo: null,
            supersedesId: null,
            changeSummary: null,
            metadata: {},
            publishedAt: new Date(),
            publishedBy: null,
            createdBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        blobStorageMocks.copyFile.mockImplementation(async ({ folder, fileName }: any) => ({
            url: `https://store.private.blob.vercel-storage.com/${folder}/copied-${fileName}`,
            name: fileName,
            mimeType: 'application/pdf',
            size: sourcePdf.length,
        }));
        blobStorageMocks.getFile.mockImplementation(async (url: string) => ({
            url,
            name: 'copied-permen.pdf',
            mimeType: 'application/pdf',
            size: sourcePdf.length,
        }));
        blobStorageMocks.downloadFile.mockResolvedValue({
            stream: Readable.from(sourcePdf),
            mimeType: 'application/pdf',
            fileName: 'copied-permen.pdf',
        });
        const draft = {
            ...active,
            id: '22222222-2222-4222-8222-222222222222',
            version: '2018.1-koreksi-data',
            status: 'draft',
            supersedesId: active.id,
        };
        enqueue([active], [draft], [classificationLeaf], []);

        await service.cloneActive('klasifikasi', {
            version: '2018.1-koreksi-data',
            effectiveFrom: '2026-08-01',
            reuseVerifiedSource: true,
            changeSummary: 'Koreksi pemetaan data dari sumber yang sama.',
        }, 'user-1');

        expect(capturedValues[0]).toMatchObject({
            sourceDocumentName: 'permen.pdf',
            sourceDocumentSha256: sourceSha256,
            sourceDocumentBlobUrl: expect.stringMatching(
                /^https:\/\/store[.]private[.]blob[.]vercel-storage[.]com\/regulatory-sources\/[0-9a-f-]{36}\//,
            ),
            sourceDocumentMimeType: 'application/pdf',
            sourceDocumentSizeBytes: sourcePdf.length,
            sourceDocumentPageCount: 1,
            sourceDocumentVerifiedAt: expect.any(Date),
            sourceDocumentVerifiedBy: 'user-1',
            sourceUrl: 'https://jdih.example.go.id/permen.pdf',
        });
        expect(capturedValues[0].sourceDocumentVerifiedAt).not.toEqual(verifiedAt);
        expect(blobStorageMocks.downloadFile).toHaveBeenCalledTimes(1);
    }, 15_000);

    it('fails closed and removes the copy when reused PDF bytes do not match sealed evidence', async () => {
        const sourcePdf = await onePagePdf();
        const active = {
            id: '10102018-1010-4010-8010-000000000010',
            instrumentType: 'klasifikasi',
            version: '2018.1',
            name: 'Klasifikasi 2018',
            legalBasis: 'Permen 10/2018',
            regulationNumber: '10/2018',
            sourceDocumentName: 'permen.pdf',
            sourceDocumentSha256: 'f'.repeat(64),
            sourceDocumentBlobUrl: 'https://store.private.blob.vercel-storage.com/regulatory-sources/10102018-1010-4010-8010-000000000010/permen-old.pdf',
            sourceDocumentMimeType: 'application/pdf',
            sourceDocumentSizeBytes: sourcePdf.length,
            sourceDocumentPageCount: 1,
            sourceDocumentVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
            sourceDocumentVerifiedBy: '33333333-3333-4333-8333-333333333333',
            sourceUrl: 'https://jdih.example.go.id/permen.pdf',
            status: 'active',
            effectiveFrom: '2018-01-01',
            effectiveTo: null,
            supersedesId: null,
            changeSummary: null,
            metadata: {},
            publishedAt: new Date(),
            publishedBy: null,
            createdBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        blobStorageMocks.copyFile.mockImplementation(async ({ folder, fileName }: any) => ({
            url: `https://store.private.blob.vercel-storage.com/${folder}/copied-${fileName}`,
            name: fileName,
            mimeType: 'application/pdf',
            size: sourcePdf.length,
        }));
        blobStorageMocks.getFile.mockImplementation(async (url: string) => ({
            url,
            name: 'copied-permen.pdf',
            mimeType: 'application/pdf',
            size: sourcePdf.length,
        }));
        blobStorageMocks.downloadFile.mockResolvedValue({
            stream: Readable.from(sourcePdf),
            mimeType: 'application/pdf',
            fileName: 'copied-permen.pdf',
        });
        enqueue([active]);

        await expect(service.cloneActive('klasifikasi', {
            version: '2018.1-invalid-copy',
            effectiveFrom: '2026-08-01',
            reuseVerifiedSource: true,
            changeSummary: 'Uji fail closed terhadap salinan berbeda.',
        }, 'user-1')).rejects.toThrow(/salinan PDF sumber berbeda/i);

        expect(blobStorageMocks.deleteFile).toHaveBeenCalledWith(expect.stringMatching(
            /^https:\/\/store[.]private[.]blob[.]vercel-storage[.]com\/regulatory-sources\/[0-9a-f-]{36}\//,
        ));
        expect(capturedValues).toHaveLength(0);
    });

    it('leaves a failed GCS source clone in the durable cleanup queue without API delete permission', async () => {
        const sourcePdf = await onePagePdf();
        const activeId = '10102018-1010-4010-8010-000000000010';
        const active = {
            id: activeId,
            instrumentType: 'klasifikasi',
            version: '2018.1',
            name: 'Klasifikasi 2018',
            legalBasis: 'Permen 10/2018',
            regulationNumber: '10/2018',
            sourceDocumentName: 'permen.pdf',
            sourceDocumentSha256: 'f'.repeat(64),
            sourceDocumentBlobUrl: `gs://simsa-final/regulatory-sources/${activeId}/permen-old.pdf`,
            sourceDocumentObjectGeneration: '1735689600111111',
            sourceDocumentMimeType: 'application/pdf',
            sourceDocumentSizeBytes: sourcePdf.length,
            sourceDocumentPageCount: 1,
            sourceDocumentVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
            sourceDocumentVerifiedBy: '33333333-3333-4333-8333-333333333333',
            sourceUrl: 'https://jdih.example.go.id/permen.pdf',
            status: 'active',
            effectiveFrom: '2018-01-01',
            effectiveTo: null,
            supersedesId: null,
            changeSummary: null,
            metadata: {},
            publishedAt: new Date(),
            publishedBy: null,
            createdBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        blobStorageMocks.copyFile.mockImplementation(async ({ folder, fileName }: any) => ({
            url: `gs://simsa-final/${folder}/copied-${fileName}`,
            generation: '1735689600222222',
            name: fileName,
            mimeType: 'application/pdf',
            size: sourcePdf.length,
        }));
        blobStorageMocks.getFile.mockImplementation(async (url: string, options: any) => ({
            url,
            generation: options.generation,
            name: 'copied-permen.pdf',
            mimeType: 'application/pdf',
            size: sourcePdf.length,
        }));
        blobStorageMocks.downloadFile.mockResolvedValue({
            stream: Readable.from(sourcePdf),
            mimeType: 'application/pdf',
            fileName: 'copied-permen.pdf',
        });
        enqueue([active]);

        await expect(service.cloneActive('klasifikasi', {
            version: '2018.1-invalid-gcs-copy',
            effectiveFrom: '2026-08-01',
            reuseVerifiedSource: true,
            changeSummary: 'Uji antrean kompensasi GCS.',
        }, 'user-1')).rejects.toThrow(/salinan PDF sumber berbeda/i);

        expect(durableFinalMocks.compensate).toHaveBeenCalledWith(
            expect.objectContaining({
                candidate: expect.objectContaining({
                    locator: expect.stringMatching(/^gs:\/\/simsa-final\/regulatory-sources\//),
                    generation: '1735689600222222',
                }),
            }),
            expect.any(Error),
        );
        expect(blobStorageMocks.deleteFileGeneration).not.toHaveBeenCalled();
        expect(blobStorageMocks.deleteFile).not.toHaveBeenCalled();
        expect(capturedValues).toHaveLength(0);
    }, 15_000);

    it('supersedes the current edition and activates a validated draft atomically', async () => {
        const item = {
            ...classificationLeaf,
            id: 21,
            contentHash: deterministicRegulatoryContentHash('klasifikasi', [classificationLeaf]),
        };
        const contentHash = deterministicRegulatoryContentHash('klasifikasi', [item]);
        const manifest = {
            expectedItemCount: 1,
            expectedSelectableCount: 1,
            sourcePageCount: 1,
            coveredPageRanges: [{ start: 1, end: 1 }],
            verificationStatement: 'Seluruh butir sudah dibandingkan dengan halaman sumber resmi.',
        };
        const impactReport = {
            schemaVersion: 1,
            instrumentType: 'klasifikasi',
            candidateRuleSetId: '22222222-2222-4222-8222-222222222222',
            predecessorRuleSetId: '11111111-1111-4111-8111-111111111111',
            candidateContentHash: contentHash,
            predecessorContentHash: contentHash,
            diff: { added: [], removed: [], changed: [], unchangedCount: 1 },
            archiveImpact: {
                usingPredecessor: 0,
                affectedByChangedOrRemovedRules: 0,
                operationalAffected: 0,
                legalHoldAffected: 0,
                snapshotReferences: 0,
            },
        };
        const candidate = {
            id: '22222222-2222-4222-8222-222222222222',
            instrumentType: 'klasifikasi',
            version: '2026.1',
            name: 'Klasifikasi 2026',
            legalBasis: 'Peraturan baru',
            regulationNumber: '1/2026',
            sourceDocumentName: 'aturan.pdf',
            sourceDocumentSha256: 'b'.repeat(64),
            sourceDocumentBlobUrl: 'https://store.private.blob.vercel-storage.com/regulatory-sources/22222222-2222-4222-8222-222222222222/aturan-a.pdf',
            sourceDocumentMimeType: 'application/pdf',
            sourceDocumentSizeBytes: 1000,
            sourceDocumentPageCount: 1,
            sourceDocumentVerifiedAt: new Date(),
            sourceDocumentVerifiedBy: 'user-source',
            sourceUrl: null,
            status: 'approved',
            effectiveFrom: '2026-01-01',
            effectiveTo: null,
            supersedesId: '11111111-1111-4111-8111-111111111111',
            changeSummary: 'Perubahan nomenklatur resmi',
            metadata: {
                contentHash,
                contentHashAlgorithm: 'sha256',
                contentSchemaVersion: 1,
                contentItemCount: 1,
                validatedAt: new Date().toISOString(),
            },
            completenessManifest: manifest,
            completenessManifestSha256: regulatoryEvidenceHash(manifest),
            completenessVerifiedAt: new Date(),
            completenessVerifiedBy: 'user-manifest',
            impactReport,
            impactReportSha256: regulatoryEvidenceHash(impactReport),
            impactReportGeneratedAt: new Date(),
            impactReportGeneratedBy: 'user-impact',
            submittedBy: 'user-1',
            reviewedBy: 'user-2',
            approvedBy: 'user-3',
            approvalNote: 'Edisi telah memenuhi hasil telaah dan siap diterbitkan.',
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
        const activated = { ...candidate, status: 'active', publishedBy: 'user-4' };
        enqueue(
            [candidate],
            [item],
            [current],
            [item],
            [superseded],
            [],
            [],
            [activated],
            [],
            [],
        );

        const result = await service.activate(candidate.id, 'user-4');

        expect(result.supersededRuleSet?.id).toBe(current.id);
        expect(result.validation.valid).toBe(true);
        expect(capturedSets[0]).toMatchObject({
            status: 'superseded',
            effectiveTo: '2025-12-31',
        });
        expect(capturedSets[1].status).toBe('active');
        expect(capturedSets[1].publishedBy).toBe('user-4');
        expect(capturedSets[1].metadata.contentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(capturedSets[1].metadata.contentHashAlgorithm).toBe('sha256');
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

    it('downloads, hashes, counts, and seals exact private Blob bytes without exposing the locator', async () => {
        const id = '22222222-2222-4222-8222-222222222222';
        const blobUrl = `https://store.private.blob.vercel-storage.com/regulatory-sources/${id}/aturan-a.pdf`;
        const buffer = await onePagePdf();
        const draft = {
            id,
            instrumentType: 'klasifikasi',
            status: 'draft',
            sourceDocumentBlobUrl: null,
        };
        const updated = {
            ...draft,
            sourceDocumentName: 'Permen ATR BPN.pdf',
            sourceDocumentBlobUrl: blobUrl,
        };
        blobStorageMocks.getFile.mockResolvedValue({
            url: blobUrl,
            name: 'aturan-a.pdf',
            mimeType: 'application/pdf',
            size: buffer.length,
        });
        blobStorageMocks.downloadFile.mockResolvedValue({
            stream: Readable.from(buffer),
            mimeType: 'application/pdf',
            fileName: 'aturan-a.pdf',
        });
        enqueue([{ status: 'draft' }], [draft], [updated], []);

        const result = await service.verifySourceDocumentFromBlob(id, {
            blobUrl,
            originalFileName: 'Permen ATR BPN.pdf',
        }, 'user-source');

        expect(capturedSets[0]).toMatchObject({
            sourceDocumentName: 'Permen ATR BPN.pdf',
            sourceDocumentBlobUrl: blobUrl,
            sourceDocumentObjectGeneration: null,
            sourceDocumentMimeType: 'application/pdf',
            sourceDocumentSizeBytes: buffer.length,
            sourceDocumentPageCount: 1,
            sourceDocumentVerifiedAt: null,
            sourceDocumentVerifiedBy: 'user-source',
            completenessManifest: null,
            impactReport: null,
        });
        expect(capturedSets[0].sourceDocumentSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(capturedValues).toContainEqual(expect.objectContaining({
            entityType: 'regulatory_rule_set',
            entityId: id,
            fileUrl: blobUrl,
            objectGeneration: null,
            malwareScanStatus: 'not_scanned',
            integrityStatus: 'baseline_recorded',
        }));
        expect(result.ruleSet.sourceDocumentBlobUrl).toBeUndefined();
        expect(result.ruleSet.sourceDocumentStored).toBe(true);
        expect(result.sourceDocument).toMatchObject({
            stored: true,
            pageCount: 1,
            verifiedAt: null,
            malwareScanStatus: 'not_scanned',
        });
    });

    it('pins GCS regulatory verification to the generation recorded by its upload lease', async () => {
        const id = '22222222-2222-4222-8222-222222222222';
        const blobUrl = `gs://simsa-preview-upload/regulatory-sources/${id}/aturan-a.pdf`;
        const generation = '1735689600123456';
        const buffer = await onePagePdf();
        const draft = { id, instrumentType: 'klasifikasi', status: 'draft', sourceDocumentBlobUrl: null };
        const updated = {
            ...draft,
            sourceDocumentBlobUrl: blobUrl,
            sourceDocumentObjectGeneration: generation,
        };
        clientBlobMocks.preAuthorizeClaim.mockResolvedValueOnce({
            id: 'lease-gcs',
            status: 'pending',
            objectGeneration: generation,
        });
        blobStorageMocks.getFile.mockResolvedValueOnce({
            url: blobUrl,
            name: 'aturan-a.pdf',
            mimeType: 'application/pdf',
            size: buffer.length,
            generation,
        });
        blobStorageMocks.downloadFile.mockResolvedValueOnce({
            stream: Readable.from(buffer),
            mimeType: 'application/pdf',
            fileName: 'aturan-a.pdf',
        });
        enqueue([{ status: 'draft' }], [draft], [updated], []);

        const result = await service.verifySourceDocumentFromBlob(id, {
            blobUrl,
            originalFileName: 'Aturan GCS.pdf',
        }, 'user-source');

        expect(clientBlobMocks.preAuthorizeClaim).toHaveBeenCalledWith({
            blobUrl,
            purpose: 'regulatory_source',
            uploadedBy: 'user-source',
        }, 10 * 60 * 1000);
        expect(blobStorageMocks.getFile).toHaveBeenCalledWith(blobUrl, { generation });
        expect(blobStorageMocks.downloadFile).toHaveBeenCalledWith(blobUrl, {
            generation,
            throwOnError: true,
        });
        expect(capturedSets[0]).toMatchObject({
            sourceDocumentBlobUrl: blobUrl,
            sourceDocumentObjectGeneration: generation,
            sourceDocumentVerifiedAt: null,
        });
        expect(capturedValues).toContainEqual(expect.objectContaining({
            entityType: 'regulatory_rule_set',
            entityId: id,
            fileUrl: blobUrl,
            objectGeneration: generation,
            malwareScanStatus: 'not_scanned',
        }));
        expect(result.ruleSet.sourceDocumentObjectGeneration).toBeUndefined();
    }, 15_000);

    it('puts a server-received regulatory PDF in GCS quarantine before registering its scan job', async () => {
        const id = '22222222-2222-4222-8222-222222222222';
        const blobUrl = `gs://simsa-preview-upload/regulatory-sources/${id}/aturan-server.pdf`;
        const generation = '1735689600123999';
        const buffer = await onePagePdf();
        const draft = { id, instrumentType: 'klasifikasi', status: 'draft' };
        const updated = {
            ...draft,
            sourceDocumentBlobUrl: blobUrl,
            sourceDocumentObjectGeneration: generation,
        };
        blobStorageMocks.uploadUntrustedFile.mockResolvedValueOnce({
            url: blobUrl,
            generation,
            mimeType: 'application/pdf',
            name: 'aturan-server.pdf',
            size: buffer.length,
        });
        enqueue([{ status: 'draft' }], [draft], [updated], []);

        await service.verifySourceDocument(id, {
            buffer,
            originalname: 'Aturan Server.pdf',
            mimetype: 'application/pdf',
            size: buffer.length,
        }, 'user-source');

        expect(blobStorageMocks.uploadUntrustedFile).toHaveBeenCalledWith(expect.objectContaining({
            folder: `regulatory-sources/${id}`,
            mimeType: 'application/pdf',
            buffer,
        }));
        expect(blobStorageMocks.uploadFile).not.toHaveBeenCalled();
        expect(capturedValues).toContainEqual(expect.objectContaining({
            entityType: 'regulatory_rule_set',
            entityId: id,
            fileUrl: blobUrl,
            objectGeneration: generation,
            malwareScanStatus: 'not_scanned',
        }));
        expect(capturedSets[0]).toMatchObject({
            sourceDocumentBlobUrl: blobUrl,
            sourceDocumentObjectGeneration: generation,
            sourceDocumentVerifiedAt: null,
        });
    }, 15_000);

    it('reads a retained GCS source only through its persisted immutable generation', async () => {
        const id = '22222222-2222-4222-8222-222222222222';
        const blobUrl = `gs://simsa-final/regulatory-sources/${id}/aturan-a.pdf`;
        const generation = '1735689600123456';
        const bytes = Buffer.from('%PDF-1.7\nprivate generation evidence');
        enqueue([{
            id,
            instrumentType: 'klasifikasi',
            version: '2026.1',
            sourceDocumentName: 'Aturan GCS.pdf',
            sourceDocumentSha256: 'a'.repeat(64),
            sourceDocumentBlobUrl: blobUrl,
            sourceDocumentObjectGeneration: generation,
            sourceDocumentMimeType: 'application/pdf',
            sourceDocumentSizeBytes: bytes.length,
            sourceDocumentVerifiedAt: new Date(),
        }]);
        blobStorageMocks.getFile.mockResolvedValueOnce({
            url: blobUrl,
            name: 'aturan-a.pdf',
            mimeType: 'application/pdf',
            size: bytes.length,
            generation,
        });
        blobStorageMocks.downloadFile.mockResolvedValueOnce({
            stream: Readable.from(bytes),
            mimeType: 'application/pdf',
            fileName: 'aturan-a.pdf',
        });

        await service.getSourceDocumentStream(id);

        expect(blobStorageMocks.getFile).toHaveBeenCalledWith(blobUrl, { generation });
        expect(blobStorageMocks.downloadFile).toHaveBeenCalledWith(blobUrl, {
            generation,
            throwOnError: true,
        });
    });

    it('returns a private PDF stream with safe metadata and keeps its locator internal', async () => {
        const id = '22222222-2222-4222-8222-222222222222';
        const blobUrl = `https://store.private.blob.vercel-storage.com/regulatory-sources/${id}/aturan-a.pdf`;
        const bytes = Buffer.from('%PDF-1.7\nprivate source evidence');
        const ruleSet = {
            id,
            instrumentType: 'klasifikasi',
            version: '2026.1',
            sourceDocumentName: 'Permen ATR BPN.pdf',
            sourceDocumentSha256: 'a'.repeat(64),
            sourceDocumentBlobUrl: blobUrl,
            sourceDocumentMimeType: 'application/pdf',
            sourceDocumentSizeBytes: bytes.length,
            sourceDocumentVerifiedAt: new Date(),
        };
        blobStorageMocks.getFile.mockResolvedValue({
            url: blobUrl,
            name: 'aturan-a.pdf',
            mimeType: 'application/pdf',
            size: bytes.length,
        });
        blobStorageMocks.downloadFile.mockResolvedValue({
            stream: Readable.from(bytes),
            mimeType: 'application/pdf',
            fileName: 'aturan-a.pdf',
        });
        enqueue([ruleSet]);

        const result = await service.getSourceDocumentStream(id);

        expect(result).toMatchObject({
            fileName: 'Permen ATR BPN.pdf',
            sizeBytes: bytes.length,
        });
        expect(result).not.toHaveProperty('blobUrl');
        expect(await new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            result.stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
            result.stream.on('end', () => resolve(Buffer.concat(chunks)));
            result.stream.on('error', reject);
        })).toEqual(bytes);
    });

    it('returns a clear conflict when a legacy baseline has no retained private PDF', async () => {
        enqueue([{
            id: '10102018-1010-4010-8010-000000000010',
            instrumentType: 'klasifikasi',
            version: '2018.1',
            sourceDocumentBlobUrl: null,
        }]);

        await expect(service.getSourceDocumentStream(
            '10102018-1010-4010-8010-000000000010',
        )).rejects.toThrow(/baseline lama belum dimigrasikan/i);
        expect(blobStorageMocks.downloadFile).not.toHaveBeenCalled();
    });

    it('seals item hashes before submitting the draft for independent review', async () => {
        const id = '22222222-2222-4222-8222-222222222222';
        const contentHash = deterministicRegulatoryContentHash('klasifikasi', [classificationLeaf]);
        const manifest = {
            expectedItemCount: 1,
            expectedSelectableCount: 1,
            sourcePageCount: 1,
            coveredPageRanges: [{ start: 1, end: 1 }],
            verificationStatement: 'Seluruh butir sudah dibandingkan dengan halaman sumber resmi.',
        };
        const impact = {
            schemaVersion: 1,
            instrumentType: 'klasifikasi',
            candidateRuleSetId: id,
            predecessorRuleSetId: null,
            candidateContentHash: contentHash,
            predecessorContentHash: null,
            diff: { added: [], removed: [], changed: [], unchangedCount: 1 },
            archiveImpact: {
                usingPredecessor: 0,
                affectedByChangedOrRemovedRules: 0,
                operationalAffected: 0,
                legalHoldAffected: 0,
                snapshotReferences: 0,
            },
        };
        const draft = {
            id,
            instrumentType: 'klasifikasi',
            status: 'draft',
            supersedesId: null,
            sourceDocumentSha256: 'b'.repeat(64),
            sourceDocumentBlobUrl: 'https://store.private.blob.vercel-storage.com/regulatory-sources/22222222-2222-4222-8222-222222222222/aturan-a.pdf',
            sourceDocumentMimeType: 'application/pdf',
            sourceDocumentSizeBytes: 1000,
            sourceDocumentPageCount: 1,
            sourceDocumentVerifiedAt: new Date(),
            sourceDocumentVerifiedBy: 'user-source',
            completenessManifest: manifest,
            completenessManifestSha256: regulatoryEvidenceHash(manifest),
            completenessVerifiedAt: new Date(),
            impactReport: impact,
            impactReportSha256: regulatoryEvidenceHash(impact),
            impactReportGeneratedAt: new Date(),
            metadata: {},
            createdBy: 'user-maker',
        };
        const submitted = { ...draft, status: 'submitted', submittedBy: 'user-maker' };
        enqueue([draft], [{ ...classificationLeaf, id: 1, contentHash: null }], [], [submitted], [], []);

        const result = await service.submit(
            id,
            'user-maker',
            'Manifest dan laporan dampak sudah diperiksa.',
        );

        expect(result.ruleSet.status).toBe('submitted');
        expect(capturedSets[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(capturedSets[1]).toMatchObject({
            status: 'submitted',
            submittedBy: 'user-maker',
            submissionNote: 'Manifest dan laporan dampak sudah diperiksa.',
        });
        expect(capturedSets[1].metadata.contentHash).toBe(contentHash);
    });

    it('prevents the maker from reviewing or approving their own edition', async () => {
        enqueue([{
            id: '22222222-2222-4222-8222-222222222222',
            instrumentType: 'klasifikasi',
            status: 'submitted',
            createdBy: 'user-maker',
            submittedBy: 'user-maker',
        }]);
        await expect(service.review(
            '22222222-2222-4222-8222-222222222222',
            'user-maker',
            'Saya menyatakan telaah sudah selesai.',
        )).rejects.toThrow(/tidak boleh menelaah/i);

        enqueue([{
            id: '22222222-2222-4222-8222-222222222222',
            instrumentType: 'klasifikasi',
            status: 'reviewed',
            createdBy: 'user-maker',
            submittedBy: 'user-maker',
            reviewedBy: 'user-reviewer',
        }]);
        await expect(service.approve(
            '22222222-2222-4222-8222-222222222222',
            'user-reviewer',
            'Saya menyatakan persetujuan sudah selesai.',
        )).rejects.toThrow(/tidak boleh menyetujui/i);
    });

    it('treats any audited content/evidence contributor as a maker', async () => {
        const id = '22222222-2222-4222-8222-222222222222';
        enqueue([{
            id,
            instrumentType: 'klasifikasi',
            status: 'submitted',
            createdBy: 'user-creator',
            submittedBy: 'user-submitter',
        }], [{ id: 'event-by-contributor' }]);

        await expect(service.review(
            id,
            'user-content-editor',
            'Saya mencoba menelaah isi yang sebelumnya saya ubah.',
        )).rejects.toThrow(/tidak boleh menelaah/i);
        expect(capturedSets).toHaveLength(0);
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
