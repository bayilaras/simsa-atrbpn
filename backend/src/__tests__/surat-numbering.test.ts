import { describe, expect, it } from 'vitest';
import { resolveSuratCalendar } from '../utils/surat-numbering.js';

describe('surat numbering calendar contract', () => {
    it('uses the letter date when no explicit year is supplied', () => {
        expect(resolveSuratCalendar({ tanggalSurat: '2026-03-17' })).toEqual({
            tahun: 2026,
            bulan: 3,
        });
    });

    it('rejects a year that disagrees with the letter date', () => {
        expect(() => resolveSuratCalendar({
            tahun: 2025,
            tanggalSurat: '2026-03-17',
        })).toThrow('Tahun penomoran harus sama');
    });

    it('rejects a calendar date that only JavaScript normalization would accept', () => {
        expect(() => resolveSuratCalendar({ tanggalSurat: '2026-02-31' }))
            .toThrow('Tanggal surat tidak valid');
    });
});
