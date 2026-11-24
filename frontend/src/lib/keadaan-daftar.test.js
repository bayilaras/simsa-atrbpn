import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    bacaKeadaanDaftar, bilanganTersimpan, hapusKeadaanDaftarPenggunaLain, hapusSemuaKeadaanDaftar,
    kunciKeadaanDaftar, pilihanTersimpan, tanggalTersimpan, tanggalUntukDisimpan, teksTersimpan,
    tulisKeadaanDaftar, UMUR_KEADAAN_MAKS_MS,
} from './keadaan-daftar'

const kunci = (userId, daftar = 'surat-masuk') => kunciKeadaanDaftar({ userId, daftar })

afterEach(() => { vi.useRealTimers() })

describe('keadaan daftar tersimpan', () => {
    it('menyimpan dan membaca kembali per pengguna dan per daftar', () => {
        tulisKeadaanDaftar(kunci('u-1'), { page: 3, cari: 'tanah' })
        expect(bacaKeadaanDaftar(kunci('u-1'))).toEqual({ page: 3, cari: 'tanah' })
        expect(bacaKeadaanDaftar(kunci('u-2'))).toBeNull()
        expect(bacaKeadaanDaftar(kunci('u-1', 'surat-keluar'))).toBeNull()
    })

    it('tanpa pengguna tidak ada yang disimpan', () => {
        expect(kunci(undefined)).toBeNull()
        expect(tulisKeadaanDaftar(null, { page: 2 })).toBe(false)
        expect(bacaKeadaanDaftar(null)).toBeNull()
    })

    it('membuang catatan yang rusak atau terlalu lama', () => {
        window.sessionStorage.setItem(kunci('u-1'), '{bukan json')
        expect(bacaKeadaanDaftar(kunci('u-1'))).toBeNull()
        expect(window.sessionStorage.getItem(kunci('u-1'))).toBeNull()

        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-11-24T02:00:00Z'))
        tulisKeadaanDaftar(kunci('u-1'), { page: 2 })
        vi.setSystemTime(Date.now() + UMUR_KEADAAN_MAKS_MS + 1)
        expect(bacaKeadaanDaftar(kunci('u-1'))).toBeNull()
    })

    it('keluar menghapus semuanya; pengguna lain yang masuk hanya menyisakan miliknya', () => {
        tulisKeadaanDaftar(kunci('u-1'), { page: 2 })
        tulisKeadaanDaftar(kunci('u-2'), { page: 5 })
        window.sessionStorage.setItem('kunci-lain', 'tetap')

        hapusKeadaanDaftarPenggunaLain('u-2')
        expect(bacaKeadaanDaftar(kunci('u-1'))).toBeNull()
        expect(bacaKeadaanDaftar(kunci('u-2'))).toEqual({ page: 5 })

        hapusSemuaKeadaanDaftar()
        expect(bacaKeadaanDaftar(kunci('u-2'))).toBeNull()
        expect(window.sessionStorage.getItem('kunci-lain')).toBe('tetap')
    })
})

describe('pembaca nilai tersimpan', () => {
    it('hanya menerima nilai dengan bentuk yang diharapkan', () => {
        expect(teksTersimpan('2025', 'all')).toBe('2025')
        expect(teksTersimpan(2025, 'all')).toBe('all')
        expect(teksTersimpan('x'.repeat(201), '')).toBe('')
        expect(pilihanTersimpan('b', ['a', 'b'], 'a')).toBe('b')
        expect(pilihanTersimpan('z', ['a', 'b'], 'a')).toBe('a')
        expect(bilanganTersimpan(4, 1)).toBe(4)
        expect(bilanganTersimpan('4', 1)).toBe(1)
        expect(bilanganTersimpan(0, 1)).toBe(1)
        expect(bilanganTersimpan(2.5, 1)).toBe(1)
    })

    it('tanggal bolak-balik tanpa bergeser hari, dan tanggal mustahil ditolak', () => {
        const tanggal = tanggalTersimpan('2026-03-01')
        expect(tanggalUntukDisimpan(tanggal)).toBe('2026-03-01')
        expect(tanggalTersimpan('2026-02-30')).toBeNull()
        expect(tanggalTersimpan('01/03/2026')).toBeNull()
        expect(tanggalTersimpan(null)).toBeNull()
        expect(tanggalUntukDisimpan(null)).toBeNull()
        expect(tanggalUntukDisimpan(new Date('x'))).toBeNull()
    })
})
