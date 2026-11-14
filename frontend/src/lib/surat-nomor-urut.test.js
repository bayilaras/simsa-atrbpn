import { describe, expect, it } from 'vitest'
import { catatanPindahTahun, galatNomorUrut, nomorUrutDiketik, tahunUrutanBaru } from './surat-nomor-urut'

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
        expect(catatanPindahTahun(2025, 'nomor agenda')).toBe('Tahun berubah. Surat akan mendapat nomor agenda baru di tahun 2025.')
    })

    it('tidak muncul untuk tanggal yang sama, tahun yang sama, atau tanggal belum lengkap', () => {
        expect(tahunUrutanBaru(dimuat, '2026-01-05')).toBeNull()
        expect(tahunUrutanBaru(dimuat, '2026-12-31')).toBeNull()
        expect(tahunUrutanBaru(dimuat, '')).toBeNull()
        expect(tahunUrutanBaru(null, '2025-12-30')).toBeNull()
    })
})
