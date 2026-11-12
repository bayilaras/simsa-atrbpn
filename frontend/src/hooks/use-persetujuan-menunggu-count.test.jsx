import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePersetujuanMenungguCount } from './use-persetujuan-menunggu-count'
import { umumkanPersetujuanMenunggu } from '@/lib/persetujuan-menunggu'

const mocks = vi.hoisted(() => ({ getPending: vi.fn() }))
vi.mock('@/services/approval.service', () => ({ default: { getPending: mocks.getPending } }))

beforeEach(() => { mocks.getPending.mockReset() })
afterEach(cleanup)

describe('usePersetujuanMenungguCount', () => {
    it('menghitung surat yang menunggu keputusan pengguna', async () => {
        mocks.getPending.mockResolvedValue([{ suratId: 'a' }, { suratId: 'b' }, { suratId: 'c' }])
        const { result } = renderHook(() => usePersetujuanMenungguCount())
        await waitFor(() => expect(result.current.total).toBe(3))
        expect(mocks.getPending).toHaveBeenCalledTimes(1)
    })

    it('tidak meminta apa pun bila dinonaktifkan', () => {
        const { result } = renderHook(() => usePersetujuanMenungguCount({ enabled: false }))
        expect(result.current.total).toBe(0)
        expect(mocks.getPending).not.toHaveBeenCalled()
    })

    it('kegagalan memuat tidak mengganggu tampilan dan jumlah tetap nol', async () => {
        mocks.getPending.mockRejectedValue(new Error('jaringan'))
        const { result } = renderHook(() => usePersetujuanMenungguCount())
        await waitFor(() => expect(mocks.getPending).toHaveBeenCalledTimes(1))
        expect(result.current.total).toBe(0)
    })

    it('memakai jumlah yang diumumkan halaman Surat Keluar tanpa permintaan tambahan', async () => {
        mocks.getPending.mockResolvedValue([{ suratId: 'a' }])
        const { result } = renderHook(() => usePersetujuanMenungguCount())
        await waitFor(() => expect(result.current.total).toBe(1))
        act(() => umumkanPersetujuanMenunggu(0))
        expect(result.current.total).toBe(0)
        expect(mocks.getPending).toHaveBeenCalledTimes(1)
    })
})
