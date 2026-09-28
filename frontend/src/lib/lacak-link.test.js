import { describe, expect, it } from 'vitest'
import { lacakHref, lacakQueryForResult } from './lacak-link'

describe('lacakQueryForResult', () => {
    it('memakai nomor surat nyata, bukan judul cadangan SM-/SK- dari pencarian global', () => {
        expect(lacakQueryForResult({ type: 'surat_masuk', title: 'B-12/PTPP.1/IX/2024', excerpt: 'Undangan' })).toBe('B-12/PTPP.1/IX/2024')
        expect(lacakQueryForResult({ type: 'surat_keluar', title: 'SK-7/2026', excerpt: '  Penjelasan Keputusan Nomor 5  ' })).toBe('Penjelasan Keputusan Nomor 5')
        expect(lacakQueryForResult({ type: 'surat_masuk', title: 'SM-1/2026', excerpt: 'ab' })).toBe('')
        expect(lacakQueryForResult({ type: 'surat_masuk', title: 'SM-1/2026', excerpt: 'x'.repeat(150) })).toHaveLength(100)
    })
})

describe('lacakHref', () => {
    it('membentuk URL /surat/lacak dengan ?q= dan ?rangkaian=', () => {
        expect(lacakHref({ q: 'B-12/PTPP' })).toBe('/surat/lacak?q=B-12%2FPTPP')
        expect(lacakHref({ rangkaianId: 'r-1' })).toBe('/surat/lacak?rangkaian=r-1')
        expect(lacakHref({ q: '  ' })).toBe('/surat/lacak')
        expect(lacakHref()).toBe('/surat/lacak')
    })
})
