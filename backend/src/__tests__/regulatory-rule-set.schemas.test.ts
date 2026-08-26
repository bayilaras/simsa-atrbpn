import { describe, expect, it } from 'vitest';
import {
    cloneActiveRuleSetSchema,
    emptyRegulatoryRuleSetActionSchema,
    importRegulatoryRuleItemsSchema,
    listRegulatoryRuleSetsQuerySchema,
    regulatoryInstrumentTypeParamSchema,
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
});
