import { act, cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aturUlangMenungguKeputusan, useMenungguKeputusanCount } from './use-menunggu-keputusan-count'
import { mintaSegarkanMenungguKeputusan } from '@/lib/menunggu-keputusan'

const mocks = vi.hoisted(() => ({ akses: vi.fn(), akun: vi.fn() }))
vi.mock('@/services/record-access-grant.service', () => ({ default: { listForReview: mocks.akses } }))
vi.mock('@/services/user-management.service', () => ({ default: { listUsers: mocks.akun } }))

const daftar = total => ({ success: true, data: [], pagination: { page: 1, limit: 1, total, totalPages: total } })
const hasil = {}
function Probe({ nama, ...opsi }) {
    const nilai = useMenungguKeputusanCount(opsi)
    useEffect(() => { hasil[nama] = nilai })
    return null
}
const tunggu = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-25T02:00:00Z'))
    aturUlangMenungguKeputusan()
    mocks.akses.mockReset().mockResolvedValue(daftar(3))
    mocks.akun.mockReset().mockResolvedValue(daftar(2))
    for (const kunci of Object.keys(hasil)) delete hasil[kunci]
})
afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

describe('useMenungguKeputusanCount', () => {
    it('menghitung permohonan akses dan akun baru dari daftar yang sudah ada, satu baris per daftar', async () => {
        render(<Probe nama="sidebar" />)
        await tunggu()
        expect(mocks.akses).toHaveBeenCalledWith({ status: 'pending', page: 1, limit: 1 })
        expect(mocks.akun).toHaveBeenCalledWith({ role: 'user', isActive: true, page: 1, limit: 1 })
        expect(hasil.sidebar).toEqual({ permohonanAkses: 3, akunBaru: 2, total: 5 })
    })

    it('sidebar dan Dashboard berbagi satu pasang permintaan per selang', async () => {
        render(<><Probe nama="sidebar" /><Probe nama="dashboard" /></>)
        await tunggu()
        expect(mocks.akses).toHaveBeenCalledTimes(1)
        expect(mocks.akun).toHaveBeenCalledTimes(1)
        expect(hasil.dashboard).toEqual(hasil.sidebar)

        await tunggu(59_000)
        expect(mocks.akses).toHaveBeenCalledTimes(1)
        mocks.akses.mockResolvedValue(daftar(4))
        await tunggu(1_000)
        expect(mocks.akses).toHaveBeenCalledTimes(2)
        expect(hasil.dashboard.permohonanAkses).toBe(4)
    })

    it('pemasangan berikutnya langsung memakai nilai terakhir', async () => {
        const { unmount } = render(<Probe nama="sidebar" />)
        await tunggu()
        unmount()
        render(<Probe nama="dashboard" />)
        expect(hasil.dashboard).toEqual({ permohonanAkses: 3, akunBaru: 2, total: 5 })
        await tunggu()
        expect(mocks.akses).toHaveBeenCalledTimes(1)
    })

    it('daftar yang gagal dimuat mempertahankan nilai terakhirnya', async () => {
        render(<Probe nama="sidebar" />)
        await tunggu()
        mocks.akses.mockRejectedValue(new Error('jaringan putus'))
        mocks.akun.mockResolvedValue(daftar(0))
        await tunggu(60_000)
        expect(hasil.sidebar).toEqual({ permohonanAkses: 3, akunBaru: 0, total: 3 })
    })

    it('halaman yang baru memutuskan sesuatu memicu hitung ulang sekali', async () => {
        render(<><Probe nama="sidebar" /><Probe nama="dashboard" /></>)
        await tunggu()
        mocks.akses.mockResolvedValue(daftar(2))
        await act(async () => { mintaSegarkanMenungguKeputusan(); await vi.advanceTimersByTimeAsync(0) })
        expect(mocks.akses).toHaveBeenCalledTimes(2)
        expect(hasil.sidebar.permohonanAkses).toBe(2)
        expect(hasil.dashboard.permohonanAkses).toBe(2)
    })

    it('tidak mengirim permintaan dan bernilai nol bila tidak diaktifkan', async () => {
        render(<Probe nama="sidebar" enabled={false} />)
        await tunggu(120_000)
        expect(mocks.akses).not.toHaveBeenCalled()
        expect(mocks.akun).not.toHaveBeenCalled()
        expect(hasil.sidebar).toEqual({ permohonanAkses: 0, akunBaru: 0, total: 0 })
    })

    it('tidak memuat saat tab tersembunyi', async () => {
        const terlihat = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
        render(<Probe nama="sidebar" />)
        await tunggu(120_000)
        expect(mocks.akses).not.toHaveBeenCalled()
        terlihat.mockReturnValue('visible')
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0) })
        expect(mocks.akses).toHaveBeenCalledTimes(1)
        terlihat.mockRestore()
    })
})
