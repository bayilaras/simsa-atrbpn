import { describe, expect, it } from 'vitest';
import { normalizeStructuredJraFields } from '../routes/jra.routes';

describe('normalizeStructuredJraFields', () => {
    it('uses explicit structured duration rather than parsing official wording', () => {
        expect(normalizeStructuredJraFields({
            retensiAktif: '2 tahun setelah SK diterbitkan',
            retensiInaktif: '3 tahun',
            keterangan: 'Musnah setelah seluruh sengketa selesai',
            activeMonths: 24,
            inactiveMonths: 36,
            calculationMode: 'duration',
            dispositionCode: 'musnah',
            triggerGuidance: 'Mulai setelah bukti SK terverifikasi.',
            isSelectable: true,
        })).toMatchObject({
            activeMonths: 24,
            inactiveMonths: 36,
            calculationMode: 'duration',
            dispositionCode: 'musnah',
        });
    });

    it('fails closed for manual/conditional rules even when text begins with a duration', () => {
        expect(normalizeStructuredJraFields({
            retensiAktif: '2 tahun setelah SK diterbitkan',
            retensiInaktif: '3 tahun',
            keterangan: 'Musnah bersyarat',
            activeMonths: 24,
            inactiveMonths: 36,
            calculationMode: 'manual',
            dispositionCode: 'manual_review',
            triggerGuidance: 'Tunggu verifikasi SK dan selesainya seluruh sengketa.',
            isSelectable: true,
        })).toMatchObject({
            activeMonths: null,
            inactiveMonths: null,
            calculationMode: 'manual',
            dispositionCode: 'manual_review',
        });
    });

    it('rejects incomplete duration and conditional automatic disposition', () => {
        expect(() => normalizeStructuredJraFields({
            activeMonths: 12,
            inactiveMonths: null,
            calculationMode: 'duration',
            dispositionCode: 'musnah',
        })).toThrow(/bulan aktif dan bulan inaktif/i);

        expect(() => normalizeStructuredJraFields({
            activeMonths: 12,
            inactiveMonths: 12,
            calculationMode: 'duration',
            dispositionCode: 'manual_review',
        })).toThrow(/mode manual/i);
    });

    it('requires explicit mode, disposition, and trigger evidence guidance', () => {
        expect(() => normalizeStructuredJraFields({
            calculationMode: 'manual',
            dispositionCode: 'manual_review',
            triggerGuidance: 'singkat',
            isSelectable: true,
        })).toThrow(/panduan pemicu/i);
        expect(() => normalizeStructuredJraFields({})).toThrow(/mode hitung/i);
    });
});
