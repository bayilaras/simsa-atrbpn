import { describe, expect, it } from 'vitest';
import {
    cloneActiveRuleSetSchema,
    emptyRegulatoryRuleSetActionSchema,
    importRegulatoryRuleItemsSchema,
    listRegulatoryRuleSetsQuerySchema,
    regulatoryCompletenessManifestSchema,
    regulatoryInstrumentTypeParamSchema,
    regulatoryWorkflowActionSchema,
    verifyRegulatorySourceBlobSchema,
} from '../validators/regulatory-rule-set.schemas';

describe('regulatory rule-set request schemas', () => {
    it('accepts a controlled clone request and normalizes SHA-256', () => {
        const parsed = cloneActiveRuleSetSchema.parse({
            version: ' 2026.1 ',
            effectiveFrom: '2026-08-26',
            sourceDocumentSha256: 'A'.repeat(64),
            changeSummary: '  Penyesuaian aturan ',
        });

        expect(parsed.version).toBe('2026.1');
        expect(parsed.changeSummary).toBe('Penyesuaian aturan');
        expect(parsed.sourceDocumentSha256).toBe('a'.repeat(64));
    });

    it('requires verified-source reuse to be explicit and prevents mixed provenance', () => {
        expect(cloneActiveRuleSetSchema.safeParse({
            version: '2026.2',
            effectiveFrom: '2026-09-01',
            reuseVerifiedSource: true,
        }).success).toBe(true);

        const mixed = cloneActiveRuleSetSchema.safeParse({
            version: '2026.2',
            effectiveFrom: '2026-09-01',
            reuseVerifiedSource: true,
            sourceDocumentSha256: 'a'.repeat(64),
        });
        expect(mixed.success).toBe(false);
        if (!mixed.success) {
            expect(mixed.error.issues[0].path).toEqual(['sourceDocumentSha256']);
        }
    });

    it('rejects impossible dates, unknown fields, and unsupported instruments', () => {
        expect(cloneActiveRuleSetSchema.safeParse({
            version: '2026.1',
            effectiveFrom: '2026-02-30',
        }).success).toBe(false);
        expect(cloneActiveRuleSetSchema.safeParse({
            version: '2026.1',
            effectiveFrom: '2026-08-26',
            status: 'active',
        }).success).toBe(false);
        expect(regulatoryInstrumentTypeParamSchema.safeParse({
            instrumentType: 'mapping',
        }).success).toBe(false);
    });

    it('keeps list filters strict and accepts a body-less action', () => {
        expect(listRegulatoryRuleSetsQuerySchema.safeParse({
            instrumentType: 'jra',
            status: 'draft',
        }).success).toBe(true);
        expect(listRegulatoryRuleSetsQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false);
        expect(emptyRegulatoryRuleSetActionSchema.parse(undefined)).toEqual({});
    });

    it('accepts only a strict Blob verification contract with a PDF filename', () => {
        expect(verifyRegulatorySourceBlobSchema.safeParse({
            blobUrl: 'https://store.private.blob.vercel-storage.com/regulatory-sources/22222222-2222-4222-8222-222222222222/source-a.pdf',
            originalFileName: 'Permen ATR BPN.pdf',
        }).success).toBe(true);
        expect(verifyRegulatorySourceBlobSchema.safeParse({
            blobUrl: 'https://store.private.blob.vercel-storage.com/source-a.pdf',
            originalFileName: '../aturan.pdf',
        }).success).toBe(false);
        expect(verifyRegulatorySourceBlobSchema.safeParse({
            blobUrl: 'https://store.private.blob.vercel-storage.com/source-a.pdf',
            originalFileName: 'aturan.exe',
        }).success).toBe(false);
    });

    it('accepts typed draft manifests and rejects mixed/unknown item fields', () => {
        expect(importRegulatoryRuleItemsSchema.safeParse({
            items: [{
                kode: 'PT.01',
                sourceRecordKey: 'new-regulation:1',
                organizationalScope: 'kementerian',
                jenis: 'Pengadaan tanah',
                tipe: 'substantif',
                level: 0,
                isSelectable: true,
            }],
        }).success).toBe(true);
        expect(importRegulatoryRuleItemsSchema.safeParse({
            items: [{
                kode: 'S.VI.A.0001',
                uraian: 'Dokumen pengadaan tanah',
                tipe: 'substantif',
                level: 0,
                calculationMode: 'duration',
                activeMonths: 24,
                inactiveMonths: 36,
                dispositionCode: 'musnah',
                unexpected: true,
            }],
        }).success).toBe(false);
    });

    it('validates completeness page coverage and substantive workflow notes', () => {
        expect(regulatoryCompletenessManifestSchema.safeParse({
            expectedItemCount: 10,
            expectedSelectableCount: 8,
            sourcePageCount: 20,
            coveredPageRanges: [{ start: 5, end: 20 }],
            verificationStatement: 'Seluruh tabel lampiran sudah dibandingkan dengan sumber.',
        }).success).toBe(true);
        expect(regulatoryCompletenessManifestSchema.safeParse({
            expectedItemCount: 8,
            expectedSelectableCount: 10,
            sourcePageCount: 20,
            coveredPageRanges: [{ start: 5, end: 21 }],
            verificationStatement: 'Seluruh tabel lampiran sudah dibandingkan dengan sumber.',
        }).success).toBe(false);
        expect(regulatoryWorkflowActionSchema.safeParse({ note: 'pendek' }).success).toBe(false);
    });
});
