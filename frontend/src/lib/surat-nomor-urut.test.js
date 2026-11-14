import { describe, expect, it } from 'vitest'
import { catatanPindahTahun, galatNomorUrut, konfirmasiNomorJauh, nomorJauhDiAtas, nomorUrutDiketik, tahunDiLuarRentang, tahunUrutanBaru } from './surat-nomor-urut'

describe('isian No. Agenda / No. Urut', () => {
    it('kosong berarti nomor otomatis; angka 1 sampai 999999 diterima', () => {
        expect(galatNomorUrut('', 'No. Agenda')).toBeNull()
        expect(galatNomorUrut(' 345 ', 'No. Agenda')).toBeNull()
        expect(nomorUrutDiketik(' 345 ')).toBe(345)
        expect(nomorUrutDiketik('')).toBeUndefined()
    })

    it.each(['0', '-1', '12a', '1.5', '1000000'])('%j ditolak dengan pesan berlabel', nilai => {
        expect(galatNomorUrut(nilai, 'No. Urut')).toBe('No. Urut harus berupa angka 1 sampai 999999')
        expect(nomorUrutDiketik(nilai)).toBeUndefined()
    })
})

describe('catatan pindah tahun pada formulir ubah', () => {
    const dimuat = { tanggalSurat: '2026-01-05', tahun: 2026 }

    it('muncul bila tanggal diubah ke tahun lain dari tahun surat', () => {
        expect(tahunUrutanBaru(dimuat, '2025-12-30')).toBe(2025)
        expect(catatanPindahTahun(2025, 'nomor agenda')).toBe('Tahun berubah. Surat akan mendapat nomor agenda baru di tahun 2025; nomor surat yang dibuat otomatis ikut diperbarui.')
    })

    it('tidak muncul untuk tanggal yang sama, tahun yang sama, atau tanggal belum lengkap', () => {
        expect(tahunUrutanBaru(dimuat, '2026-01-05')).toBeNull()
        expect(tahunUrutanBaru(dimuat, '2026-12-31')).toBeNull()
        expect(tahunUrutanBaru(dimuat, '')).toBeNull()
        expect(tahunUrutanBaru(null, '2025-12-30')).toBeNull()
    })
})

describe('rentang tahun dan nomor jauh di atas nomor otomatis', () => {
    it('tahun di luar 2000-2100 dikenali', () => {
        expect(tahunDiLuarRentang('1999-12-31')).toBe(true)
        expect(tahunDiLuarRentang('2101-01-01')).toBe(true)
        expect(tahunDiLuarRentang('2026-03-02')).toBe(false)
    })

    it('meminta konfirmasi hanya bila nomor lebih dari 100 di atas nomor otomatis berikutnya', () => {
        expect(nomorJauhDiAtas(109, 9)).toBe(false)
        expect(nomorJauhDiAtas(110, 9)).toBe(true)
        expect(nomorJauhDiAtas(345, undefined)).toBe(false)
        expect(konfirmasiNomorJauh(9)).toBe('Nomor yang diisi jauh di atas nomor otomatis berikutnya (9). Nomor setelahnya akan melanjutkan dari angka ini dan tidak dapat diturunkan lagi. Lanjutkan?')
    })
})
