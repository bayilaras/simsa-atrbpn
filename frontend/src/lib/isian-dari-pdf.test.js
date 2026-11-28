import { describe, expect, it } from 'vitest'
import { PETA_ISIAN_SURAT_KELUAR, PETA_ISIAN_SURAT_MASUK, keadaanUsulan, usulanIsian } from './isian-dari-pdf'

const terbaca = {
    nomorSurat: 'B/123/CTH.01/XI/2026',
    tanggalSurat: '2026-11-12',
    perihal: 'Permintaan Data Contoh',
    pengirim: 'Direktur Jenderal Contoh',
    penerima: 'Kepala Kantor Wilayah Contoh',
    jenisSurat: 'Nota Dinas',
}

describe('usulan isian formulir surat dari hasil baca server', () => {
    it('memetakan isian server ke isian formulir surat masuk', () => {
        expect(usulanIsian(PETA_ISIAN_SURAT_MASUK, terbaca)).toEqual([
            { isian: 'jenisSurat', label: 'Jenis Surat', nilai: 'Nota Dinas', tampilan: 'Nota Dinas' },
            { isian: 'nomorSurat', label: 'Nomor Surat', nilai: 'B/123/CTH.01/XI/2026', tampilan: 'B/123/CTH.01/XI/2026' },
            { isian: 'tanggalSurat', label: 'Tanggal Surat', nilai: '2026-11-12', tampilan: '12 November 2026' },
            { isian: 'perihal', label: 'Perihal', nilai: 'Permintaan Data Contoh', tampilan: 'Permintaan Data Contoh' },
            { isian: 'dari', label: 'Dari (Pengirim)', nilai: 'Direktur Jenderal Contoh', tampilan: 'Direktur Jenderal Contoh' },
            { isian: 'kepada', label: 'Kepada (Penerima)', nilai: 'Kepala Kantor Wilayah Contoh', tampilan: 'Kepala Kantor Wilayah Contoh' },
        ])
    })

    it('surat keluar tidak memakai pengirim dan menamai jenis sebagai Naskah Dinas', () => {
        const usulan = usulanIsian(PETA_ISIAN_SURAT_KELUAR, terbaca)
        expect(usulan.map(butir => butir.isian)).toEqual(['naskahDinas', 'nomorSurat', 'tanggalSurat', 'perihal', 'kepada'])
        expect(usulan[0]).toMatchObject({ label: 'Naskah Dinas', nilai: 'Nota Dinas' })
    })

    it('tidak pernah mengusulkan sifat surat atau kelas keamanan', () => {
        const usulan = usulanIsian(PETA_ISIAN_SURAT_MASUK, { ...terbaca, sifatSurat: 'rahasia', klasifikasiKeamanan: 'rahasia' })
        expect(usulan.map(butir => butir.isian)).not.toContain('sifatSurat')
        for (const peta of [PETA_ISIAN_SURAT_MASUK, PETA_ISIAN_SURAT_KELUAR]) {
            expect(peta.map(butir => butir.isian)).not.toEqual(expect.arrayContaining(['sifatSurat']))
            expect(peta.map(butir => butir.isian)).not.toEqual(expect.arrayContaining(['klasifikasiKeamanan']))
        }
    })

    it('melewati nilai kosong, bukan teks, jenis di luar pilihan, dan tanggal yang bukan tanggal isian', () => {
        expect(usulanIsian(PETA_ISIAN_SURAT_MASUK, {
            nomorSurat: '   ', tanggalSurat: '12 November 2026', perihal: null, pengirim: 42, penerima: ['x'], jenisSurat: 'Surat Cinta',
        })).toEqual([])
        expect(usulanIsian(PETA_ISIAN_SURAT_MASUK, null)).toEqual([])
        expect(usulanIsian(PETA_ISIAN_SURAT_MASUK, 'teks')).toEqual([])
    })
})

describe('keadaan usulan terhadap isian formulir', () => {
    const usulan = usulanIsian(PETA_ISIAN_SURAT_MASUK, terbaca)

    it('isian kosong dapat diisi; yang sudah diketik tidak ditimpa', () => {
        const keadaan = keadaanUsulan(usulan, {
            jenisSurat: '', nomorSurat: '  ', tanggalSurat: '2026-11-12', perihal: 'Perihal ketikan petugas', dari: '', kepada: 'Kepala Kantor Wilayah Contoh',
        })
        expect(Object.fromEntries(keadaan.map(butir => [butir.isian, butir.keadaan]))).toEqual({
            jenisSurat: 'kosong', nomorSurat: 'kosong', tanggalSurat: 'sama', perihal: 'terisi', dari: 'kosong', kepada: 'sama',
        })
    })

    it('formulir tanpa isian itu dianggap kosong', () => {
        expect(keadaanUsulan(usulan, {}).every(butir => butir.keadaan === 'kosong')).toBe(true)
        expect(keadaanUsulan(usulan, undefined).every(butir => butir.keadaan === 'kosong')).toBe(true)
    })
})
