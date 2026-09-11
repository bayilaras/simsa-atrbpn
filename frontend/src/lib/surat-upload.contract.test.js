import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('surat upload picker contract', () => {
    it.each(['TambahSuratMasuk', 'TambahSuratKeluar'])('%s advertises only the supported file formats', (page) => {
        const sourcePath = `../pages/${page}.jsx`;
        const source = readFileSync(new URL(sourcePath, import.meta.url), 'utf8');
        expect(source).toContain('accept=".pdf,application/pdf"');
        expect(source).toContain('PDF (maks. 10 MiB)');
        expect(source).not.toContain('PNG, ZIP, RAR');
    });
});
