import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    UMUR_DRAF_MAKS_MS,
    bacaDrafIsian,
    generasiDrafIsian,
    hapusDrafPenggunaLain,
    hapusSemuaDrafIsian,
    kunciDrafIsian,
    permintaanPulihkanDraf,
    tulisDrafIsian,
} from './draf-isian'

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    sessionStorage.clear()
})

describe('draf isian di sessionStorage tab', () => {
    it('memakai kunci per pengguna, formulir, dan rekod, dan tidak memakai localStorage', () => {
        const kunci = kunciDrafIsian({ userId: 'u-1', formulir: 'surat-masuk' })
        expect(kunci).toBe('simsa-isian:u-1:surat-masuk:baru')
        expect(kunciDrafIsian({ userId: 'u-1', formulir: 'surat-masuk', idRekod: 'sm-9' })).toBe('simsa-isian:u-1:surat-masuk:sm-9')
        expect(kunciDrafIsian({ formulir: 'surat-masuk' })).toBeNull()

        expect(tulisDrafIsian(kunci, { formData: { perihal: 'Permohonan data' } })).toBe(true)
        expect(bacaDrafIsian(kunci)).toMatchObject({ data: { formData: { perihal: 'Permohonan data' } } })
        expect(localStorage.length).toBe(0)
        expect(bacaDrafIsian(kunciDrafIsian({ userId: 'u-2', formulir: 'surat-masuk' }))).toBeNull()
    })

    it('tidak menawarkan draf yang terlalu lama atau rusak', () => {
        vi.useFakeTimers()
        const kunci = kunciDrafIsian({ userId: 'u-1', formulir: 'surat-keluar' })
        tulisDrafIsian(kunci, { formData: {} })
        vi.advanceTimersByTime(UMUR_DRAF_MAKS_MS + 1)
        expect(bacaDrafIsian(kunci)).toBeNull()
        expect(sessionStorage.getItem(kunci)).toBeNull()

        sessionStorage.setItem(kunci, '{rusak')
        expect(bacaDrafIsian(kunci)).toBeNull()
        expect(sessionStorage.getItem(kunci)).toBeNull()
    })

    it('keluar menghapus semua draf dan membuang penulisan yang dijadwalkan sebelumnya', () => {
        const generasiLama = generasiDrafIsian()
        const kunci = kunciDrafIsian({ userId: 'u-1', formulir: 'surat-masuk' })
        tulisDrafIsian(kunci, { formData: { perihal: 'A' } })
        sessionStorage.setItem('kunci-lain', 'tetap')
        hapusSemuaDrafIsian()
        expect(bacaDrafIsian(kunci)).toBeNull()
        expect(sessionStorage.getItem('kunci-lain')).toBe('tetap')
        expect(tulisDrafIsian(kunci, { formData: { perihal: 'Terlambat' } }, generasiLama)).toBe(false)
        expect(bacaDrafIsian(kunci)).toBeNull()
    })

    it('masuk sebagai pengguna lain menghapus draf pengguna sebelumnya di tab ini', () => {
        const milikA = kunciDrafIsian({ userId: 'u-a', formulir: 'surat-masuk' })
        const milikB = kunciDrafIsian({ userId: 'u-b', formulir: 'surat-keluar', idRekod: 'sk-1' })
        tulisDrafIsian(milikA, { formData: {} })
        tulisDrafIsian(milikB, { formData: {} })
        hapusDrafPenggunaLain('u-b')
        expect(bacaDrafIsian(milikA)).toBeNull()
        expect(bacaDrafIsian(milikB)).not.toBeNull()
    })

    it('tetap berjalan bila peramban menolak penyimpanan', () => {
        const kunci = kunciDrafIsian({ userId: 'u-1', formulir: 'surat-masuk' })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('penuh', 'QuotaExceededError') })
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('ditolak', 'SecurityError') })
        expect(tulisDrafIsian(kunci, { formData: {} })).toBe(false)
        expect(bacaDrafIsian(kunci)).toBeNull()
        expect(() => hapusSemuaDrafIsian()).not.toThrow()
    })

    it('menyebut berkas yang perlu dipilih ulang pada tawaran pemulihan', () => {
        const permintaan = permintaanPulihkanDraf({ disimpanPada: Date.now(), data: { namaBerkas: 'pindai.pdf' } })
        expect(permintaan).toMatchObject({ judul: 'Pulihkan isian yang belum disimpan?', aksi: 'Pulihkan isian', batal: 'Buang isian' })
        expect(permintaan.pesan).toContain('Berkas pindai.pdf tidak ikut tersimpan; pilih ulang berkasnya setelah memulihkan isian.')
        expect(permintaanPulihkanDraf({ disimpanPada: Date.now(), data: {} }).pesan).not.toContain('Berkas')
        expect(permintaanPulihkanDraf(null)).toBeNull()
    })
})
