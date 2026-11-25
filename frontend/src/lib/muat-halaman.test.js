import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GalatMuatHalaman, KUNCI_MUAT_ULANG_HALAMAN, adalahGalatMuatHalaman, buatPemuatHalaman } from './muat-halaman'
import { adaPerubahanBelumDisimpan, tandaiBelumDisimpan } from './perubahan-belum-disimpan'

const GAGAL_UNDUH = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/Laporan-abc.js'))
const penanda = () => window.sessionStorage.getItem(KUNCI_MUAT_ULANG_HALAMAN)

// Janji yang sengaja tidak pernah selesai: tunggu sebentar, lalu pastikan belum selesai.
async function belumSelesai(janji) {
    const hasil = await Promise.race([
        janji.then(() => 'selesai', () => 'gagal'),
        new Promise(resolve => setTimeout(() => resolve('menunggu'), 10)),
    ])
    expect(hasil).toBe('menunggu')
}

describe('pemuatan berkas halaman', () => {
    let muatUlang
    let muatHalaman

    beforeEach(() => {
        window.sessionStorage.clear()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        muatUlang = vi.fn()
        muatHalaman = buatPemuatHalaman({ muatUlang, sedangDaring: () => true })
    })
    afterEach(() => vi.restoreAllMocks())

    it('meneruskan halaman yang berhasil dimuat tanpa memuat ulang', async () => {
        const modul = { default: () => null }
        await expect(muatHalaman(() => Promise.resolve(modul))()).resolves.toBe(modul)
        expect(muatUlang).not.toHaveBeenCalled()
        expect(penanda()).toBeNull()
    })

    it('memuat ulang halaman sekali saat berkas halaman gagal diunduh', async () => {
        const janji = muatHalaman(GAGAL_UNDUH)()
        await belumSelesai(janji)
        expect(muatUlang).toHaveBeenCalledOnce()
        expect(penanda()).not.toBeNull()
    })

    it('tidak memuat ulang lagi bila sesudah dimuat ulang masih gagal', async () => {
        await belumSelesai(muatHalaman(GAGAL_UNDUH)())
        // Setelah dimuat ulang, penanda di sessionStorage masih ada.
        const galat = await muatHalaman(GAGAL_UNDUH)().catch(error => error)
        expect(galat).toBeInstanceOf(GalatMuatHalaman)
        expect(adalahGalatMuatHalaman(galat)).toBe(true)
        expect(galat.cause).toBeInstanceOf(TypeError)
        expect(muatUlang).toHaveBeenCalledOnce()
    })

    it('halaman yang berhasil dimuat menghapus penanda, sehingga kegagalan berikutnya dimuat ulang lagi', async () => {
        await belumSelesai(muatHalaman(GAGAL_UNDUH)())
        await muatHalaman(() => Promise.resolve({ default: () => null }))()
        expect(penanda()).toBeNull()
        await belumSelesai(muatHalaman(GAGAL_UNDUH)())
        expect(muatUlang).toHaveBeenCalledTimes(2)
    })

    it('tidak pernah memuat ulang tab yang memegang isian belum disimpan', async () => {
        const token = {}
        tandaiBelumDisimpan(token, true)
        try {
            expect(adaPerubahanBelumDisimpan()).toBe(true)
            const pemuat = buatPemuatHalaman({ muatUlang, sedangDaring: () => true })
            await expect(pemuat(GAGAL_UNDUH)()).rejects.toBeInstanceOf(GalatMuatHalaman)
            expect(muatUlang).not.toHaveBeenCalled()
            expect(penanda()).toBeNull()
        } finally {
            tandaiBelumDisimpan(token, false)
        }
    })

    it('tidak memuat ulang saat peramban sedang luring', async () => {
        const pemuat = buatPemuatHalaman({ muatUlang, sedangDaring: () => false })
        await expect(pemuat(GAGAL_UNDUH)()).rejects.toBeInstanceOf(GalatMuatHalaman)
        expect(muatUlang).not.toHaveBeenCalled()
    })

    it('tidak memuat ulang bila penanda tidak dapat disimpan', async () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('ditolak') })
        await expect(muatHalaman(GAGAL_UNDUH)()).rejects.toBeInstanceOf(GalatMuatHalaman)
        expect(muatUlang).not.toHaveBeenCalled()
    })

    it('galat lain bukan galat muat halaman', () => {
        expect(adalahGalatMuatHalaman(new Error('render gagal'))).toBe(false)
        expect(adalahGalatMuatHalaman(null)).toBe(false)
    })
})
