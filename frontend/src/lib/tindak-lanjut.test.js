import { describe, expect, it } from 'vitest'
import {
    JENIS_RELASI_LABEL,
    buildTindakLanjutState,
    isKeputusan,
    isSifatTerkendali,
    normalisasiSifat,
    toTindakLanjutPayload,
} from './tindak-lanjut'

describe('normalisasiSifat / isSifatTerkendali', () => {
    it('memetakan alias sifat/urgensi lama ke biasa', () => {
        expect(normalisasiSifat('Sangat Segera')).toBe('biasa')
        expect(normalisasiSifat('biasa/terbuka')).toBe('biasa')
        expect(normalisasiSifat(undefined)).toBe('biasa')
        expect(normalisasiSifat('')).toBe('biasa')
    })

    it('nilai tak dikenal TIDAK dianggap terkendali (beda dari draf awal rencana)', () => {
        expect(isSifatTerkendali('klasifikasi-aneh')).toBe(false)
    })

    it('hanya terbatas/rahasia/sangat_rahasia yang terkendali', () => {
        expect(isSifatTerkendali('Sangat Rahasia')).toBe(true)
        expect(isSifatTerkendali('terbatas')).toBe(true)
        expect(isSifatTerkendali('rahasia')).toBe(true)
        expect(isSifatTerkendali('biasa')).toBe(false)
        expect(isSifatTerkendali(undefined)).toBe(false)
    })
})

describe('isKeputusan', () => {
    it('mendeteksi naskah dinas Keputusan tanpa memandang huruf besar/kecil', () => {
        expect(isKeputusan('Keputusan')).toBe(true)
        expect(isKeputusan('keputusan direktur jenderal')).toBe(true)
    })

    it('menolak naskah dinas lain atau kosong', () => {
        expect(isKeputusan('Nota Dinas')).toBe(false)
        expect(isKeputusan(undefined)).toBe(false)
    })
})

describe('JENIS_RELASI_LABEL', () => {
    it('memuat label untuk setiap jenis relasi', () => {
        expect(JENIS_RELASI_LABEL).toEqual({
            balasan: 'Balasan',
            tindak_lanjut: 'Tindak lanjut',
            menjelaskan: 'Menjelaskan',
            merujuk: 'Merujuk',
        })
    })
})

describe('buildTindakLanjutState', () => {
    const suratMasuk = {
        id: 'sm-1', nomorSurat: 'B-12/2026', perihal: 'Permohonan data', dari: 'Pemda',
        rangkaian: { kode: 'RS-2026-000001' }, distribusiUnitSaya: { id: 'd1', status: 'sent' },
    }

    it('saya_balas: relasi balasan, disposisi hidup diikutkan, preset balasan', () => {
        expect(buildTindakLanjutState('surat_masuk', suratMasuk, 'saya_balas')).toEqual({
            tindakLanjut: {
                jenis: 'surat_masuk', suratId: 'sm-1', nomorSurat: 'B-12/2026', perihal: 'Permohonan data',
                rangkaianKode: 'RS-2026-000001', distribusiId: 'd1', jenisRelasi: 'balasan', terkunci: true,
            },
            preset: { perihal: 'Balasan: Permohonan data', kepada: 'Pemda' },
        })
    })

    it('distribusi rejected tidak diikutkan sebagai distribusiId', () => {
        const surat = { ...suratMasuk, distribusiUnitSaya: { id: 'd1', status: 'rejected' } }
        const hasil = buildTindakLanjutState('surat_masuk', surat, 'saya_balas')
        expect(hasil.tindakLanjut.distribusiId).toBeUndefined()
    })

    it('buat_nd_penjelas: relasi menjelaskan, preset ND Penjelas', () => {
        const surat = { id: 'sk-1', nomorSurat: 'KEP-7/2026', perihal: 'Penetapan tim', naskahDinas: 'Keputusan' }
        expect(buildTindakLanjutState('surat_keluar', surat, 'buat_nd_penjelas')).toEqual({
            tindakLanjut: { jenis: 'surat_keluar', suratId: 'sk-1', nomorSurat: 'KEP-7/2026', perihal: 'Penetapan tim', rangkaianKode: null, jenisRelasi: 'menjelaskan', terkunci: true },
            preset: { naskahDinas: 'Nota Dinas', perihal: 'Penjelasan Keputusan Nomor KEP-7/2026' },
        })
    })

    it('buat_nota_dinas: relasi tindak_lanjut, preset Nota Dinas', () => {
        const surat = { id: 'sk-2', nomorSurat: 'ND-1/2026', perihal: 'Rapat koordinasi' }
        const hasil = buildTindakLanjutState('surat_masuk', surat, 'buat_nota_dinas')
        expect(hasil.tindakLanjut.jenisRelasi).toBe('tindak_lanjut')
        expect(hasil.preset).toEqual({ naskahDinas: 'Nota Dinas', perihal: 'Tindak lanjut: Rapat koordinasi' })
    })
})

describe('toTindakLanjutPayload', () => {
    it('mengembalikan undefined bila tidak ada referensi', () => {
        expect(toTindakLanjutPayload(undefined)).toBeUndefined()
        expect(toTindakLanjutPayload(null)).toBeUndefined()
    })

    it('menyertakan distribusiId hanya bila ada', () => {
        expect(toTindakLanjutPayload({ jenis: 'surat_masuk', suratId: 'sm-1', jenisRelasi: 'balasan', distribusiId: 'd1', terkunci: true }))
            .toEqual({ jenis: 'surat_masuk', suratId: 'sm-1', jenisRelasi: 'balasan', distribusiId: 'd1' })
        expect(toTindakLanjutPayload({ jenis: 'surat_keluar', suratId: 'sk-1', jenisRelasi: 'tindak_lanjut', terkunci: true }))
            .toEqual({ jenis: 'surat_keluar', suratId: 'sk-1', jenisRelasi: 'tindak_lanjut' })
    })
})
