import { describe, expect, it } from 'vitest';
import { formulirMetadata, getFormulirMetadata } from './formulir-metadata';

describe('formulir reference metadata', () => {
    it('labels all 33 empty templates', () => {
        expect(formulirMetadata).toHaveLength(33);
        expect(formulirMetadata.every(form => form.name.startsWith(`Formulir ${form.id}: `))).toBe(true);
    });

    it('links only the forms that a page really produces from application data', () => {
        const bertautan = formulirMetadata.filter(form => form.path).map(form => [form.id, form.path, form.label]);
        expect(bertautan).toEqual([
            [4, '/arsip', 'Ekspor dari Arsip'],
            [6, '/arsip', 'Ekspor dari Arsip'],
            [27, '/arsip-vital', 'Buka Arsip Vital'],
        ]);
        // Peminjaman, Laporan, dan Tunjuk Silang tidak mencetak formulir ini;
        // Penyusutan dan Arsip Terjaga tidak aktif di produksi.
        for (const id of [1, 2, 3, 5, 7, 11, 12, 26, 28, 29, 33]) {
            expect(getFormulirMetadata(id)).not.toHaveProperty('path');
        }
    });
});
