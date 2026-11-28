import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
    MAKS_HALAMAN_TEKS_SURAT, MAKS_KARAKTER_TEKS_SURAT, susunBarisPdf, teksDariDokumenPdf,
} from './teks-pdf'

const backend = path.resolve(import.meta.dirname, '../../../backend/src')
const contoh = JSON.parse(readFileSync(path.join(backend, '__tests__/fixtures/pdf-text-lines.json'), 'utf8'))
const sumberServer = readFileSync(path.join(backend, 'services/letter-text-fields.ts'), 'utf8')

function dokumenPalsu(halaman) {
    const getPage = vi.fn(async (nomor) => ({ getTextContent: async () => ({ items: halaman[nomor - 1] }) }))
    return { numPages: halaman.length, getPage }
}

const baris = (teks, y = 700) => ({ str: teks, transform: [12, 0, 0, 12, 50, y], width: teks.length * 6, height: 12 })

describe('susunan baris teks PDF, sama dengan pembaca di server', () => {
    it.each(contoh.kasus)('$nama', ({ items, teks }) => {
        expect(susunBarisPdf(items)).toBe(teks)
    })

    it('batas panjang teks sama dengan batas server', () => {
        const batasServer = Number(sumberServer.match(/LETTER_FORM_TEXT_MAX_CHARS = ([\d_]+)/)[1].replaceAll('_', ''))
        expect(MAKS_KARAKTER_TEKS_SURAT).toBe(batasServer)
    })
})

describe('teks halaman awal dokumen', () => {
    it('menggabungkan halaman dengan baris kosong dan melewati halaman tanpa teks', async () => {
        const dokumen = dokumenPalsu([[baris('Nomor : 1/CTH/XI/2026')], [], [baris('Lampiran satu')]])
        expect(await teksDariDokumenPdf(dokumen)).toBe('Nomor : 1/CTH/XI/2026\n\nLampiran satu')
    })

    it('mengembalikan string kosong untuk PDF hasil pindai', async () => {
        expect(await teksDariDokumenPdf(dokumenPalsu([[], []]))).toBe('')
        expect(await teksDariDokumenPdf({ numPages: 0, getPage: vi.fn() })).toBe('')
        expect(await teksDariDokumenPdf(null)).toBe('')
    })

    it('hanya membaca halaman awal', async () => {
        const dokumen = dokumenPalsu(Array.from({ length: MAKS_HALAMAN_TEKS_SURAT + 3 }, (_, i) => [baris(`Halaman ${i + 1}`)]))
        const teks = await teksDariDokumenPdf(dokumen)
        expect(dokumen.getPage).toHaveBeenCalledTimes(MAKS_HALAMAN_TEKS_SURAT)
        expect(teks).toContain(`Halaman ${MAKS_HALAMAN_TEKS_SURAT}`)
        expect(teks).not.toContain(`Halaman ${MAKS_HALAMAN_TEKS_SURAT + 1}`)
    })

    it('berhenti membaca dan memotong teks pada batas panjang', async () => {
        const panjang = 'x'.repeat(MAKS_KARAKTER_TEKS_SURAT)
        const dokumen = dokumenPalsu([[baris('Nomor : 9/CTH/XI/2026')], [baris(panjang)], [baris('Tidak terbaca')]])
        const teks = await teksDariDokumenPdf(dokumen)
        expect(teks.length).toBeLessThanOrEqual(MAKS_KARAKTER_TEKS_SURAT)
        expect(teks.startsWith('Nomor : 9/CTH/XI/2026')).toBe(true)
        expect(dokumen.getPage).toHaveBeenCalledTimes(2)
    })
})
