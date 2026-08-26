import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import classificationSeed from '../db/data/klasifikasi-atr-bpn-10-2018.json';
import jraSeed from '../db/data/jra-atr-bpn-8-2020.json';
import { validateRegulatoryRuleItems } from '../services/regulatory-rule-set.service';

function assetHash(records: unknown[]) {
    return createHash('sha256').update(JSON.stringify(records), 'utf8').digest('hex');
}

describe('official regulatory seed assets', () => {
    it('contains the complete versioned classification hierarchy for every organizational scope', () => {
        expect(classificationSeed.source.sha256).toBe(
            '9964954acae6bf9dfb2c1aaf55dea473a21b3aff6f78d6a47c2698c4c4550f6f',
        );
        expect(classificationSeed.records).toHaveLength(842);
        expect(classificationSeed.records.filter((item) => item.isSelectable)).toHaveLength(620);
        expect(classificationSeed.expectedCounts.byScope).toEqual({
            kantah: 102,
            kanwil: 106,
            kementerian: 634,
        });
        expect(Object.fromEntries(
            Object.keys(classificationSeed.expectedCounts.byScope).map((scope) => [
                scope,
                classificationSeed.records.filter((item) => item.organizationalScope === scope).length,
            ]),
        )).toEqual(classificationSeed.expectedCounts.byScope);
        expect(assetHash(classificationSeed.records)).toBe(classificationSeed.contentSha256);
        expect(JSON.stringify(classificationSeed)).not.toMatch(/local_path|C:\\Users|https?:\/\//i);

        const report = validateRegulatoryRuleItems('klasifikasi', classificationSeed.records);
        expect(report.valid).toBe(true);
        expect(report.stats).toMatchObject({ total: 842, selectable: 620, roots: 47 });
    });

    it('keeps all 391 legal JRA rows selectable and automates only plain outcomes', () => {
        expect(jraSeed.source.sha256).toBe(
            '322f741d7585b1a703171f3ba1587e879610597d0d93d0d997111c0e6ba03b30',
        );
        expect(jraSeed.records).toHaveLength(545);
        const leaves = jraSeed.records.filter((item) => item.isSelectable);
        expect(leaves).toHaveLength(391);
        expect(new Set(jraSeed.records.map((item) => item.kode)).size).toBe(545);
        expect(assetHash(jraSeed.records)).toBe(jraSeed.contentSha256);
        expect(JSON.stringify(jraSeed)).not.toMatch(/source_pdf|C:\\Users|https?:\/\//i);

        for (const item of leaves) {
            if (item.dispositionCode === 'musnah') expect(item.keterangan?.toLowerCase()).toBe('musnah');
            if (item.dispositionCode === 'permanen') expect(item.keterangan?.toLowerCase()).toBe('permanen');
            if (!['musnah', 'permanen'].includes(item.keterangan?.toLowerCase() || '')) {
                expect(item.dispositionCode).toBe('manual_review');
            }
        }

        const report = validateRegulatoryRuleItems('jra', jraSeed.records);
        expect(report.valid).toBe(true);
        expect(report.stats).toMatchObject({ total: 545, selectable: 391, roots: 22 });
    });
});
