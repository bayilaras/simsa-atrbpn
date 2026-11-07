import { describe, expect, it } from 'vitest';
import { normalizeSifatSurat, sifatSuratMasukSumber } from '../services/sifat-surat.js';

describe('normalizeSifatSurat', () => {
    it.each([
        ['Biasa', 'biasa'], ['PENTING', 'penting'], [' Segera ', 'segera'],
        ['Sangat Segera', 'sangat_segera'], ['sangat_segera', 'sangat_segera'], ['Sangat-Segera', 'sangat_segera'],
    ])('maps the register value %j to the form key %j', (raw, key) => {
        expect(normalizeSifatSurat(raw)).toBe(key);
    });

    it('keeps an unrecognized source value as written, bounded to the column', () => {
        expect(normalizeSifatSurat('Kilat')).toBe('Kilat');
        expect(normalizeSifatSurat('x'.repeat(80))).toHaveLength(50);
    });

    it.each(['', '  ', '-', undefined, null])('records no sifat for %j', raw => {
        expect(normalizeSifatSurat(raw)).toBeNull();
    });
});

describe('sifatSuratMasukSumber', () => {
    it.each(['', '  ', '-', ' - ', undefined, null])('reads %j as Biasa', raw => {
        expect(sifatSuratMasukSumber(raw)).toBe('Biasa');
    });

    it('keeps any other value as written, trimmed', () => {
        expect(sifatSuratMasukSumber(' Sangat Segera ')).toBe('Sangat Segera');
        expect(sifatSuratMasukSumber('Konfidensial')).toBe('Konfidensial');
    });

    it('never truncates, so the security class is judged on the whole value', () => {
        const value = `Biasa${' '.repeat(48)}Rahasia`;
        expect(value).toHaveLength(60);
        expect(sifatSuratMasukSumber(value)).toBe(value);
    });
});
