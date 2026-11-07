// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
    adaKelasTersembunyi,
    bolehMemilihKelas,
    kelasUntukPeran,
    normalisasiKelas,
    saringOpsiKelas,
} from './kelas-keamanan'

const SIFAT_MASUK = ['biasa', 'segera', 'sangat_segera', 'rahasia', 'undangan', 'penting'].map(value => ({ value }))
const KELAS_KELUAR = ['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'].map(value => ({ value }))

describe('kelas keamanan per peran', () => {
    it('mengikuti normalisasi backend', () => {
        expect(normalisasiKelas('')).toBe('biasa')
        expect(normalisasiKelas('  ')).toBe('biasa')
        expect(normalisasiKelas('Sangat Segera')).toBe('biasa')
        expect(normalisasiKelas('Sangat-Rahasia')).toBe('sangat_rahasia')
        expect(normalisasiKelas(' Rahasia ')).toBe('rahasia')
    })

    it('membaca urgensi Kilat dan Amat Segera/Kilat sebagai Biasa, seperti backend', () => {
        for (const sifat of ['Kilat', 'Amat Segera', 'Amat Segera/Kilat', 'Amat Segera / Kilat', 'Biasa / Terbuka']) {
            expect(normalisasiKelas(sifat)).toBe('biasa')
        }
        expect(bolehMemilihKelas('staff', 'Amat Segera/Kilat')).toBe(true)
        expect(normalisasiKelas('Konfidensial')).toBe('konfidensial')
    })

    it('mengikuti kelasUntukRole backend', () => {
        expect(kelasUntukPeran('super_admin')).toEqual(['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'])
        expect(kelasUntukPeran('admin_unit')).toEqual(['biasa', 'terbatas'])
        expect(kelasUntukPeran('admin_dirjen')).toEqual(['biasa', 'terbatas'])
        expect(kelasUntukPeran('staff')).toEqual(['biasa'])
        expect(kelasUntukPeran(undefined)).toEqual([])
    })

    it('menolak kelas tak dikenal untuk semua peran', () => {
        expect(bolehMemilihKelas('super_admin', 'rahasia_negara')).toBe(false)
    })

    it('menyembunyikan Rahasia dari Admin Unit Kerja pada sifat surat masuk', () => {
        const values = saringOpsiKelas(SIFAT_MASUK, 'admin_unit').map(option => option.value)
        expect(values).toEqual(['biasa', 'segera', 'sangat_segera', 'undangan', 'penting'])
        expect(adaKelasTersembunyi(SIFAT_MASUK, 'admin_unit')).toBe(true)
        expect(saringOpsiKelas(SIFAT_MASUK, 'super_admin')).toHaveLength(SIFAT_MASUK.length)
        expect(adaKelasTersembunyi(SIFAT_MASUK, 'super_admin')).toBe(false)
    })

    it('membatasi Admin Unit Kerja pada Biasa dan Terbatas untuk klasifikasi keamanan', () => {
        expect(saringOpsiKelas(KELAS_KELUAR, 'admin_unit').map(option => option.value)).toEqual(['biasa', 'terbatas'])
    })

    it('tetap menampilkan kelas yang sudah melekat pada rekod', () => {
        expect(saringOpsiKelas(KELAS_KELUAR, 'admin_unit', 'rahasia').map(option => option.value))
            .toEqual(['biasa', 'terbatas', 'rahasia'])
        expect(saringOpsiKelas(KELAS_KELUAR, 'admin_unit', '').map(option => option.value))
            .toEqual(['biasa', 'terbatas'])
    })
})
