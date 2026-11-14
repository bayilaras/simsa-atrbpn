import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { JENIS_NASKAH_DINAS } from './jenis-naskah'

// Formulir masih memegang salinan daftarnya sendiri. Selama itu, daftar di
// formulir wajib sama dengan daftar bersama yang dipakai filter daftar surat,
// agar setiap jenis yang dapat disimpan juga dapat disaring.
function pilihanFormulir(page, konstanta) {
    // Jalur lewat variabel: Vite menulis ulang new URL(`...${x}`, import.meta.url) menjadi impor glob.
    const jalur = `../pages/${page}.jsx`
    const sumber = readFileSync(new URL(jalur, import.meta.url), 'utf8')
    if (sumber.includes("from '@/lib/jenis-naskah'")) return [...JENIS_NASKAH_DINAS]
    const awal = sumber.indexOf(`const ${konstanta} = [`)
    expect(awal, `${page}: ${konstanta} tidak ditemukan`).toBeGreaterThan(-1)
    const isi = sumber.slice(awal, sumber.indexOf('];', awal))
    return [...isi.matchAll(/'([^']+)'/g)].map((cocok) => cocok[1])
}

describe('daftar jenis surat dan naskah dinas bersama', () => {
    it.each([
        ['TambahSuratMasuk', 'JENIS_SURAT_OPTIONS'],
        ['TambahSuratKeluar', 'NASKAH_DINAS_OPTIONS'],
    ])('%s menawarkan daftar yang sama dengan filter daftar surat', (page, konstanta) => {
        expect(pilihanFormulir(page, konstanta)).toEqual([...JENIS_NASKAH_DINAS])
    })

    it('tidak memuat nama ganda', () => {
        expect(new Set(JENIS_NASKAH_DINAS).size).toBe(JENIS_NASKAH_DINAS.length)
    })
})
