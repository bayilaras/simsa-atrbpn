import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('surat upload picker contract', () => {
    it.each(['TambahSuratMasuk', 'TambahSuratKeluar'])('%s advertises only the supported file formats', (page) => {
        const sourcePath = `../pages/${page}.jsx`;
        const source = readFileSync(new URL(sourcePath, import.meta.url), 'utf8');
        expect(source).toContain('accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"');
        expect(source).toContain('PDF, DOC, DOCX, JPG, PNG (maks. 10MB)');
        expect(source).not.toContain('PNG, ZIP, RAR');
    });
});
