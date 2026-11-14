import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { JENIS_NASKAH_DINAS } from './jenis-naskah'

// Formulir dan filter daftar surat memakai satu daftar bersama, agar setiap
// jenis yang dapat disimpan juga dapat disaring. Salinan daftar di formulir
// akan cepat berbeda dari daftar filter, jadi tidak boleh ada lagi.
function sumberHalaman(page) {
    // Jalur lewat variabel: Vite menulis ulang new URL(`...${x}`, import.meta.url) menjadi impor glob.
    const jalur = `../pages/${page}.jsx`
    return readFileSync(new URL(jalur, import.meta.url), 'utf8')
}

describe('daftar jenis surat dan naskah dinas bersama', () => {
    it.each([
        ['TambahSuratMasuk', 'JENIS_SURAT_OPTIONS'],
        ['TambahSuratKeluar', 'NASKAH_DINAS_OPTIONS'],
    ])('%s memakai daftar bersama, bukan salinannya sendiri', (page, salinanLama) => {
        const sumber = sumberHalaman(page)
        expect(sumber).toContain("import { JENIS_NASKAH_DINAS } from '@/lib/jenis-naskah'")
        expect(sumber).toContain('options={JENIS_NASKAH_DINAS}')
        expect(sumber).not.toContain(salinanLama)
        expect(sumber).not.toContain("'Permohonan Hak Wakaf'")
    })

    it('tidak memuat nama ganda', () => {
        expect(new Set(JENIS_NASKAH_DINAS).size).toBe(JENIS_NASKAH_DINAS.length)
    })
})
