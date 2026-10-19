import { describe, expect, it } from 'vitest';
import { normalizeSifatSurat } from '../services/sifat-surat.js';

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
