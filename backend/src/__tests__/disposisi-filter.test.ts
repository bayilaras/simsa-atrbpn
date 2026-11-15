import { describe, expect, it } from 'vitest';
import { LABEL_SEED } from '../../scripts/backfill-rangkaian-lama.mjs';
import { LABEL_DISPOSISI_LAMA_PER_UNIT } from '../services/disposisi-filter';

const urut = (peta: Record<string, readonly string[]>) => Object.fromEntries(
    Object.entries(peta).map(([unit, label]) => [unit, [...label].sort()]).sort(([a], [b]) => a.localeCompare(b)),
);

describe('label disposisi lama per unit pada filter daftar surat masuk', () => {
    it('sama dengan pemetaan berunit skrip backfill data lama', () => {
        const dariSkrip: Record<string, string[]> = {};
        for (const { label, unit } of LABEL_SEED as ReadonlyArray<{ label: string; unit: string | null }>) {
            if (unit) (dariSkrip[unit] ??= []).push(label);
        }
        expect(urut(LABEL_DISPOSISI_LAMA_PER_UNIT)).toEqual(urut(dariSkrip));
    });
});
