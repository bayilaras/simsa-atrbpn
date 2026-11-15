import { describe, expect, it } from 'vitest'
import { labelKelasKeamanan, labelStatusPenyusutan } from './label-arsip'

describe('label arsip', () => {
    it('status penyusutan memakai label, bukan kode mentah', () => {
        expect(labelStatusPenyusutan('active')).toBe('Aktif')
        expect(labelStatusPenyusutan(null)).toBe('Aktif')
        expect(labelStatusPenyusutan('proposed_musnah')).toBe('Diusulkan musnah')
        expect(labelStatusPenyusutan('proposed_alih_media')).toBe('Diusulkan alih media')
        expect(labelStatusPenyusutan('approved')).toBe('Penyusutan disetujui')
        expect(labelStatusPenyusutan('executed')).toBe('Penyusutan dilaksanakan')
        expect(labelStatusPenyusutan('kode_baru')).toBe('Tidak diketahui')
    })

    it('klasifikasi keamanan memakai label layar', () => {
        expect(labelKelasKeamanan('sangat_rahasia')).toBe('Sangat Rahasia')
        expect(labelKelasKeamanan('Rahasia')).toBe('Rahasia')
        expect(labelKelasKeamanan(null)).toBe('Biasa')
        expect(labelKelasKeamanan('segera')).toBe('Biasa')
    })
})
