import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'
import { aturUlangKontakServer } from '../lib/sesi-masuk'
import { bacaDrafIsian, kunciDrafIsian, tulisDrafIsian } from '../lib/draf-isian'

// Draf isian formulir bertahan saat sesi berakhir (tidak aktif atau ditolak
// server) agar dapat dipulihkan setelah masuk kembali, tetapi dihapus saat
// pengguna menekan Keluar, dan draf pengguna lain dihapus saat seseorang masuk.

const service = vi.hoisted(() => ({
    getSession: vi.fn(), signOut: vi.fn(), refreshSession: vi.fn(), signInWithEmail: vi.fn(),
}))
vi.mock('../services/auth.service', () => ({ authService: service }))
vi.mock('../lib/offline-storage', () => ({ clearOfflineStorage: vi.fn().mockResolvedValue({}) }))

const MENIT = 60 * 1000
const KUNCI = kunciDrafIsian({ userId: 'u-1', formulir: 'surat-masuk' })
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
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-14T03:00:00Z'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    aturUlangKontakServer()
    service.getSession.mockReset().mockResolvedValue({ user: { id: 'u-1', role: 'admin_unit', unitKerjaId: 'dir_bppt' } })
    service.signOut.mockReset().mockResolvedValue(undefined)
    service.refreshSession.mockReset().mockResolvedValue('aktif')
})
afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('draf isian dan akhir sesi', () => {
    it('tetap ada setelah sesi berakhir karena 30 menit tidak aktif', async () => {
        await masuk()
        tulisDrafIsian(KUNCI, { formData: { perihal: 'Isian sebelum istirahat' } })
        await lewati(30 * MENIT)
        expect(service.signOut).toHaveBeenCalledOnce()
        expect(auth.user).toBeNull()
        expect(bacaDrafIsian(KUNCI).data.formData.perihal).toBe('Isian sebelum istirahat')
    })

    it('tetap ada saat server tidak lagi menerima sesi', async () => {
        await masuk()
        tulisDrafIsian(KUNCI, { formData: { perihal: 'Isian saat sesi ditolak' } })
        service.refreshSession.mockResolvedValue('berakhir')
        await lewati(5 * MENIT)
        await act(async () => {
            window.dispatchEvent(new Event('mousemove'))
            await vi.advanceTimersByTimeAsync(0)
        })
        expect(service.signOut).toHaveBeenCalledOnce()
        expect(bacaDrafIsian(KUNCI)).not.toBeNull()
    })

    it('dihapus saat pengguna menekan Keluar', async () => {
        await masuk()
        tulisDrafIsian(KUNCI, { formData: { perihal: 'Isian di komputer bersama' } })
        // Tombol Keluar memanggil signOut dengan event klik.
        await act(async () => { await auth.signOut({ type: 'click' }) })
        expect(bacaDrafIsian(KUNCI)).toBeNull()
    })

    it('draf pengguna lain di tab ini dihapus saat pengguna masuk', async () => {
        const milikLain = kunciDrafIsian({ userId: 'u-lama', formulir: 'surat-keluar' })
        tulisDrafIsian(milikLain, { formData: { perihal: 'Draf pengguna sebelumnya' } })
        tulisDrafIsian(KUNCI, { formData: { perihal: 'Draf sendiri' } })
        await masuk()
        expect(bacaDrafIsian(milikLain)).toBeNull()
        expect(bacaDrafIsian(KUNCI)).not.toBeNull()
    })
})
