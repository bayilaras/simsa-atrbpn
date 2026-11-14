import { beforeEach, describe, expect, it } from 'vitest'
import {
    alamatMasukSetelahSesiDitolak,
    aturUlangKontakServer,
    catatKontakServer,
    lamaTanpaKontak,
    sesiBerakhirKarenaTidakAktif,
} from './sesi-masuk'

const MENIT = 60 * 1000
const SEKARANG = Date.UTC(2026, 10, 14, 3, 0, 0)

describe('alasan sesi ditolak server', () => {
    beforeEach(() => aturUlangKontakServer())

    it('tidak menyebut tidak ada aktivitas sebelum server pernah menerima sesi', () => {
        expect(lamaTanpaKontak(SEKARANG)).toBe(Infinity)
        expect(sesiBerakhirKarenaTidakAktif(SEKARANG)).toBe(false)
        expect(alamatMasukSetelahSesiDitolak(SEKARANG)).toBe('/login')
    })

    it('menganggap sesi ditutup dengan cara lain bila server menerimanya kurang dari 30 menit lalu', () => {
        catatKontakServer(SEKARANG - 29 * MENIT)
        expect(lamaTanpaKontak(SEKARANG)).toBe(29 * MENIT)
        expect(sesiBerakhirKarenaTidakAktif(SEKARANG)).toBe(false)
        expect(alamatMasukSetelahSesiDitolak(SEKARANG)).toBe('/login')
    })

    it('menjelaskan sesi yang habis karena tidak dipakai setelah 30 menit tanpa kontak', () => {
        catatKontakServer(SEKARANG - 30 * MENIT)
        expect(sesiBerakhirKarenaTidakAktif(SEKARANG)).toBe(true)
        expect(alamatMasukSetelahSesiDitolak(SEKARANG)).toBe('/login?sesi=berakhir')
    })
})
