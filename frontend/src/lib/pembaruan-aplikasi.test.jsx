import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buatPembaruanAplikasi } from './pembaruan-aplikasi'
import { tandaiBelumDisimpan } from './perubahan-belum-disimpan'
import { PemberitahuanVersiBaru } from '@/components/PemberitahuanVersiBaru'

// Versi baru SIMSA tidak lagi memuat ulang halaman sendiri: pengguna diberi
// tahu dan memilih kapan memuat ulang, dan tab yang memegang isian belum
// disimpan tidak pernah dimuat ulang tanpa diminta.

function siapkan({ isianBelumDisimpan = false } = {}) {
    const muatUlang = vi.fn()
    const perbarui = vi.fn().mockResolvedValue(undefined)
    let opsi
    const registerSW = vi.fn((o) => { opsi = o; return perbarui })
    const pembaruan = buatPembaruanAplikasi({
        muatUlang,
        adaIsianBelumDisimpan: () => isianBelumDisimpan,
        setTimeoutFn: vi.fn(),
    })
    pembaruan.daftarkan(registerSW)
    return { pembaruan, muatUlang, perbarui, opsi: () => opsi }
}

afterEach(cleanup)

describe('pembaruan aplikasi dengan pemberitahuan', () => {
    it('versi baru yang menunggu hanya memunculkan pemberitahuan, tanpa memuat ulang', () => {
        const { pembaruan, muatUlang, opsi } = siapkan()
        opsi().onNeedRefresh()
        expect(pembaruan.keadaan()).toEqual({ tersedia: true })
        expect(muatUlang).not.toHaveBeenCalled()
    })

    it('Muat ulang mengaktifkan versi baru lalu memuat ulang tab ini', () => {
        const { pembaruan, muatUlang, perbarui, opsi } = siapkan({ isianBelumDisimpan: true })
        opsi().onNeedRefresh()
        pembaruan.muatUlangVersiBaru()
        expect(perbarui).toHaveBeenCalledWith(true)
        expect(muatUlang).not.toHaveBeenCalled()
        // Service worker baru mengambil alih halaman.
        opsi().onNeedReload()
        expect(muatUlang).toHaveBeenCalledOnce()
    })

    it('tab yang memegang isian belum disimpan tidak dimuat ulang saat tab lain mengaktifkan versi baru', () => {
        const { pembaruan, muatUlang, opsi } = siapkan({ isianBelumDisimpan: true })
        opsi().onNeedReload()
        expect(muatUlang).not.toHaveBeenCalled()
        expect(pembaruan.keadaan()).toEqual({ tersedia: true })
        // Versi baru sudah aktif; Muat ulang langsung memuat ulang.
        pembaruan.muatUlangVersiBaru()
        expect(muatUlang).toHaveBeenCalledOnce()
    })

    it('tab tanpa isian belum disimpan mengikuti versi yang diaktifkan tab lain', () => {
        const { muatUlang, opsi } = siapkan()
        opsi().onNeedReload()
        expect(muatUlang).toHaveBeenCalledOnce()
    })

    it('formulir yang sudah diubah ditandai memegang isian belum disimpan', async () => {
        const { adaPerubahanBelumDisimpan } = await import('./perubahan-belum-disimpan')
        const token = {}
        expect(adaPerubahanBelumDisimpan()).toBe(false)
        tandaiBelumDisimpan(token, true)
        expect(adaPerubahanBelumDisimpan()).toBe(true)
        tandaiBelumDisimpan(token, false)
        expect(adaPerubahanBelumDisimpan()).toBe(false)
    })
})

describe('pemberitahuan versi baru', () => {
    it('menampilkan pesan dengan tombol Muat ulang dan dapat ditunda', () => {
        const { pembaruan, opsi } = siapkan()
        const muatUlangVersiBaru = vi.spyOn(pembaruan, 'muatUlangVersiBaru')
        render(<PemberitahuanVersiBaru pembaruan={pembaruan} />)
        expect(screen.queryByRole('status')).toBeNull()

        act(() => opsi().onNeedRefresh())
        expect(screen.getByRole('status')).toHaveTextContent('Versi baru SIMSA tersedia. Simpan pekerjaan Anda, lalu muat ulang.')
        fireEvent.click(screen.getByRole('button', { name: 'Muat ulang' }))
        expect(muatUlangVersiBaru).toHaveBeenCalledOnce()

        fireEvent.click(screen.getByRole('button', { name: 'Nanti' }))
        expect(screen.queryByRole('status')).toBeNull()
    })

    it('konfigurasi PWA memakai mode prompt, bukan pembaruan otomatis', () => {
        // Jalur lewat variabel: Vite menulis ulang new URL('...', import.meta.url) menjadi alamat aset.
        const baca = (jalur) => readFileSync(new URL(jalur, import.meta.url), 'utf8')
        const konfigurasi = baca(['..', '..', 'vite.config.js'].join('/'))
        expect(konfigurasi).toContain("registerType: 'prompt'")
        expect(konfigurasi).not.toContain("registerType: 'autoUpdate'")
        const main = baca(['..', 'main.jsx'].join('/'))
        expect(main).toContain('pembaruanAplikasi.daftarkan(registerSW)')
        expect(main).toContain('<PemberitahuanVersiBaru />')
    })
})
