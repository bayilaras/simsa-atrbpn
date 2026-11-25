import { act, cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'
import { aturUlangKontakServer, ingatHalamanKembali } from '../lib/sesi-masuk'

// Halaman yang dibuka saat sesi berakhir diingat untuk pengguna yang sama.
// Pengalihan ke halaman masuk (App.jsx) dan penolakan server (services/api.js)
// yang mencatat halamannya lewat ingatHalamanKembali; AuthContext menentukan
// siapa pengguna tab ini dan kapan ingatan itu dibuang.

const service = vi.hoisted(() => ({
    getSession: vi.fn(), signOut: vi.fn(), refreshSession: vi.fn(), signInWithEmail: vi.fn(),
}))
vi.mock('../services/auth.service', () => ({ authService: service }))
vi.mock('../lib/offline-storage', () => ({ clearOfflineStorage: vi.fn().mockResolvedValue({}) }))

const MENIT = 60 * 1000
const KUNCI = 'simsa:halaman-kembali'
const HALAMAN = '/surat/masuk/tambah?dari=daftar'
const pengguna = id => ({ user: { id, role: 'admin_unit', unitKerjaId: 'dir_bppt' } })
let auth
function Probe() {
    const current = useAuth()
    useEffect(() => { auth = current }, [current])
    return null
}

async function lewati(ms) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

async function masuk() {
    render(<AuthProvider><Probe /></AuthProvider>)
    await lewati(0)
    expect(auth.user).toMatchObject({ id: 'u-1' })
}

async function masukLagi() {
    let tujuan
    await act(async () => { tujuan = await auth.signInWithEmail('pegawai@example.test', 'sandi-sintetis') })
    return tujuan
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-14T03:00:00Z'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    aturUlangKontakServer()
    window.localStorage.clear()
    window.sessionStorage.clear()
    service.getSession.mockReset().mockResolvedValue(pengguna('u-1'))
    service.signOut.mockReset().mockResolvedValue(undefined)
    service.refreshSession.mockReset().mockResolvedValue('aktif')
    service.signInWithEmail.mockReset().mockResolvedValue({})
})
afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('halaman kembali setelah sesi berakhir', () => {
    it('pengguna yang sama dibawa kembali setelah sesi berakhir karena 30 menit tidak aktif', async () => {
        await masuk()
        expect(auth.halamanKembali).toBeNull()
        await lewati(30 * MENIT)
        expect(auth.user).toBeNull()
        // Pengalihan ke halaman masuk mencatat halaman yang sedang dibuka.
        ingatHalamanKembali(HALAMAN)

        expect(await masukLagi()).toBe(HALAMAN)
        expect(auth.user).toMatchObject({ id: 'u-1' })
        expect(auth.halamanKembali).toBe(HALAMAN)

        // Dipakai sekali: setelah pengguna sampai di sana, ingatan dikosongkan.
        act(() => auth.hapusHalamanKembali())
        expect(auth.halamanKembali).toBeNull()
        expect(JSON.parse(window.sessionStorage.getItem(KUNCI))).toEqual({ userId: 'u-1', alamat: null })
    })

    it('tetap diingat saat server tidak lagi menerima sesi', async () => {
        await masuk()
        service.refreshSession.mockResolvedValue('berakhir')
        await lewati(5 * MENIT)
        await act(async () => {
            window.dispatchEvent(new Event('mousemove'))
            await vi.advanceTimersByTimeAsync(0)
        })
        expect(auth.user).toBeNull()
        ingatHalamanKembali(HALAMAN)

        expect(await masukLagi()).toBe(HALAMAN)
    })

    it('pengguna lain yang masuk mendarat di Dashboard dan halaman itu dibuang', async () => {
        await masuk()
        await lewati(30 * MENIT)
        ingatHalamanKembali(HALAMAN)

        service.getSession.mockResolvedValue(pengguna('u-2'))
        expect(await masukLagi()).toBeNull()
        expect(auth.user).toMatchObject({ id: 'u-2' })
        expect(auth.halamanKembali).toBeNull()
        expect(JSON.parse(window.sessionStorage.getItem(KUNCI))).toEqual({ userId: 'u-2', alamat: null })
    })

    it('keluar dengan sengaja membuang halaman yang diingat; masuk berikutnya mulai dari Dashboard', async () => {
        await masuk()
        ingatHalamanKembali(HALAMAN)
        await act(async () => { await auth.signOut() })
        expect(auth.user).toBeNull()
        expect(window.sessionStorage.getItem(KUNCI)).toBeNull()

        // Pengalihan ke halaman masuk setelah Keluar tidak mengingat apa pun.
        ingatHalamanKembali(HALAMAN)
        expect(window.sessionStorage.getItem(KUNCI)).toBeNull()

        expect(await masukLagi()).toBeNull()
        expect(auth.halamanKembali).toBeNull()
    })

    it('tombol Keluar (dipanggil dengan peristiwa klik) dihitung sebagai keluar dengan sengaja', async () => {
        await masuk()
        ingatHalamanKembali(HALAMAN)
        await act(async () => { await auth.signOut({ type: 'click' }) })
        expect(window.sessionStorage.getItem(KUNCI)).toBeNull()
    })

    it('halaman yang diingat ditemukan lagi saat halaman dimuat ulang setelah server menolak sesi', async () => {
        // services/api.js mencatat halaman lalu memuat halaman masuk; AuthProvider baru
        // menemukannya setelah pengguna yang sama masuk.
        window.sessionStorage.setItem(KUNCI, JSON.stringify({ userId: 'u-1', alamat: HALAMAN }))
        service.getSession.mockResolvedValueOnce(null)
        render(<AuthProvider><Probe /></AuthProvider>)
        await lewati(0)
        expect(auth.user).toBeNull()
        expect(auth.halamanKembali).toBeNull()

        expect(await masukLagi()).toBe(HALAMAN)
        expect(auth.halamanKembali).toBe(HALAMAN)
    })
})
