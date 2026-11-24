import { describe, expect, it } from 'vitest'
import { kelompokSiklusArsip } from './kelompok-siklus-arsip'

const jumlah = (kelompok) => kelompok.reduce((total, item) => total + item.value, 0)

describe('kelompokSiklusArsip', () => {
    it('memasukkan arsip tanpa pemicu retensi ke Belum Ditentukan', () => {
        const kelompok = kelompokSiklusArsip({ aktif: 0, inaktif: 0, kadaluarsa: 0, belumDitentukan: 0, missingTrigger: 25, held: 0, total: 25 })
        expect(kelompok.map(item => item.label)).toEqual(['Aktif', 'Inaktif', 'Kadaluarsa', 'Belum Ditentukan'])
        expect(kelompok[3].value).toBe(25)
        expect(jumlah(kelompok)).toBe(25)
    })

    it('menampilkan penahanan hukum sebagai kelompok tersendiri sehingga jumlahnya sama dengan total', () => {
        const kelompok = kelompokSiklusArsip({ aktif: 4, inaktif: 3, kadaluarsa: 1, belumDitentukan: 2, missingTrigger: 5, held: 2, total: 17 })
        expect(kelompok.at(-1)).toMatchObject({ label: 'Penahanan hukum', value: 2 })
        expect(jumlah(kelompok)).toBe(17)
    })

    it('tahan terhadap data kosong', () => {
        expect(kelompokSiklusArsip(undefined).every(item => item.value === 0)).toBe(true)
        expect(kelompokSiklusArsip({ aktif: null, held: 'x' })).toHaveLength(4)
    })
})
