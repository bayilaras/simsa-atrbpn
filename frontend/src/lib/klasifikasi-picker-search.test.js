import { describe, expect, it } from 'vitest'
import { filterKlasifikasiPickerItems } from './klasifikasi-picker-search'

describe('filterKlasifikasiPickerItems', () => {
    it('keeps a structured code search narrow even when its prefix is a thesaurus alias', () => {
        const target = {
            id: 'target',
            kode: 'TU.02.01',
            sourceCode: 'TU.02.01',
            jenis: 'Pengelolaan Kearsipan',
            kategori: 'Ketatausahaan',
            tipe: 'fasilitatif',
        }
        const distractors = Array.from({ length: 1_000 }, (_, index) => ({
            id: `distractor-${index}`,
            kode: `XX.${String(index).padStart(4, '0')}`,
            sourceCode: `XX.${String(index).padStart(4, '0')}`,
            jenis: `Administrasi Struktural ${index}`,
            kategori: 'Umum',
            tipe: 'fasilitatif',
        }))

        const result = filterKlasifikasiPickerItems([target, ...distractors], 'all', 'TU.02.01')

        expect(result).toEqual([target])
    })

    it('retains semantic thesaurus matching when no classification code matches', () => {
        const equivalent = {
            kode: 'PT.01',
            jenis: 'Musyawarah Penetapan Ganti Kerugian',
            tipe: 'substantif',
        }

        expect(filterKlasifikasiPickerItems([equivalent], 'all', 'ganti rugi')).toEqual([equivalent])
    })

    it('sorts a copy without mutating the API response order', () => {
        const items = [
            { kode: 'B.01', jenis: 'B', tipe: 'fasilitatif' },
            { kode: 'A.01', jenis: 'A', tipe: 'fasilitatif' },
        ]

        expect(filterKlasifikasiPickerItems(items, 'fasilitatif', '')).toEqual([items[1], items[0]])
        expect(items.map((item) => item.kode)).toEqual(['B.01', 'A.01'])
    })
})
