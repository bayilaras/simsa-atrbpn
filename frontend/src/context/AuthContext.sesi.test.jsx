import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'
import { aturUlangKontakServer, catatKontakServer, PESAN_SESI_BERAKHIR } from '../lib/sesi-masuk'

const service = vi.hoisted(() => ({
    getSession: vi.fn(), signOut: vi.fn(), refreshSession: vi.fn(), signInWithEmail: vi.fn(),
}))
vi.mock('../services/auth.service', () => ({ authService: service }))
vi.mock('../lib/offline-storage', () => ({ clearOfflineStorage: vi.fn().mockResolvedValue({}) }))

const MENIT = 60 * 1000
let auth
function Probe() {
    const current = useAuth()
    useEffect(() => { auth = current }, [current])
    return null
}

async function lewati(ms) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

async function aktivitas() {
    await act(async () => {
        window.dispatchEvent(new Event('mousemove'))
        await vi.advanceTimersByTimeAsync(0)
    })
}

async function masuk() {
    render(<AuthProvider><Probe /></AuthProvider>)
    await lewati(0)
    expect(auth.user).toMatchObject({ id: 'u-1' })
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-14T03:00:00Z'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    aturUlangKontakServer()
    service.getSession.mockReset().mockResolvedValue({ user: { id: 'u-1', role: 'staff', unitKerjaId: 'dir_bppt' } })
    service.signOut.mockReset().mockResolvedValue(undefined)
    service.refreshSession.mockReset().mockResolvedValue('aktif')
    service.signInWithEmail.mockReset().mockResolvedValue({})
})
afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('sesi tanpa aktivitas', () => {
    it('keluar setelah 30 menit tanpa aktivitas dan menyimpan alasannya untuk halaman masuk', async () => {
        await masuk()
        await lewati(30 * MENIT)
        expect(service.signOut).toHaveBeenCalledOnce()
        expect(auth.user).toBeNull()
        expect(auth.sessionNotice).toBe(PESAN_SESI_BERAKHIR)

        await act(async () => { await auth.signInWithEmail('pegawai@example.test', 'sandi-sintetis') })
        expect(auth.sessionNotice).toBeNull()
    })

    it('meminta server memperpanjang sesi bila pengguna aktif tetapi tidak ada permintaan selama lima menit', async () => {
        await masuk()
        await lewati(5 * MENIT)
        await aktivitas()
        expect(service.refreshSession).toHaveBeenCalledOnce()
        expect(service.signOut).not.toHaveBeenCalled()

        // Jawaban server dihitung sebagai kontak: aktivitas berikutnya tidak bertanya lagi.
        await lewati(MENIT)
        await aktivitas()
        expect(service.refreshSession).toHaveBeenCalledOnce()
        expect(auth.user).toMatchObject({ id: 'u-1' })
    })

    it('tidak bertanya selama respons API masih diterima server', async () => {
        await masuk()
        await lewati(4 * MENIT)
        catatKontakServer()
        await lewati(2 * MENIT)
        await aktivitas()
        expect(service.refreshSession).not.toHaveBeenCalled()
    })

    it('mengakhiri sesi dengan keterangan tidak ada aktivitas bila server sudah membuangnya', async () => {
        service.refreshSession.mockResolvedValue('berakhir')
        await masuk()
        // Komputer tertidur 31 menit: jam berjalan, pengatur waktu halaman tidak.
        vi.setSystemTime(Date.now() + 31 * MENIT)
        await aktivitas()
        expect(service.signOut).toHaveBeenCalledOnce()
        expect(auth.user).toBeNull()
        expect(auth.sessionNotice).toBe(PESAN_SESI_BERAKHIR)
    })

    it('tidak menyalahkan ketiadaan aktivitas bila server menutup sesi lebih cepat', async () => {
        service.refreshSession.mockResolvedValue('berakhir')
        await masuk()
        await lewati(6 * MENIT)
        await aktivitas()
        expect(service.signOut).toHaveBeenCalledOnce()
        expect(auth.user).toBeNull()
        expect(auth.sessionNotice).toBeNull()
    })

    it('tetap masuk bila server tidak dapat dihubungi dan bertanya lagi pada aktivitas berikutnya', async () => {
        service.refreshSession.mockResolvedValueOnce('tidak-diketahui').mockResolvedValue('aktif')
        await masuk()
        await lewati(6 * MENIT)
        await aktivitas()
        expect(service.signOut).not.toHaveBeenCalled()
        await lewati(MENIT)
        await aktivitas()
        expect(service.refreshSession).toHaveBeenCalledTimes(2)
        expect(auth.user).toMatchObject({ id: 'u-1' })
    })
})
