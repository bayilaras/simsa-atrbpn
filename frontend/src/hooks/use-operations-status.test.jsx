import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOperationsStatus } from './use-operations-status'
import { OPERATIONS_STATUS_REFRESH_MS, umumkanStatusOperasional } from '@/lib/operations-status'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/services/api', () => ({ default: { get: mocks.get } }))

let visibility = 'visible'
beforeEach(() => {
    mocks.get.mockReset()
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('useOperationsStatus', () => {
    it('membaca status operasional sekali saat dipasang', async () => {
        mocks.get.mockResolvedValue({ success: true, data: { status: 'attention', checks: [] } })
        const { result } = renderHook(() => useOperationsStatus())
        await waitFor(() => expect(result.current.status).toBe('attention'))
        expect(mocks.get).toHaveBeenCalledTimes(1)
        expect(mocks.get).toHaveBeenCalledWith('/api/operations/status')
    })

    it('tidak meminta apa pun bila dinonaktifkan', () => {
        const { result } = renderHook(() => useOperationsStatus({ enabled: false }))
        expect(result.current.status).toBeNull()
        expect(mocks.get).not.toHaveBeenCalled()
    })

    it('meminta paling sering sekali per lima menit', async () => {
        vi.useFakeTimers()
        mocks.get.mockResolvedValue({ data: { status: 'healthy' } })
        renderHook(() => useOperationsStatus())
        await act(async () => { await vi.advanceTimersByTimeAsync(0) })
        expect(OPERATIONS_STATUS_REFRESH_MS).toBe(300_000)
        expect(mocks.get).toHaveBeenCalledTimes(1)
        await act(async () => { await vi.advanceTimersByTimeAsync(299_000) })
        // Kembali ke tab sebelum lima menit tidak memicu permintaan baru.
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
        expect(mocks.get).toHaveBeenCalledTimes(1)
        await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
        expect(mocks.get).toHaveBeenCalledTimes(2)
    })

    it('tidak meminta selama tab tersembunyi dan memeriksa lagi saat tab terlihat', async () => {
        visibility = 'hidden'
        mocks.get.mockResolvedValue({ data: { status: 'failed' } })
        const { result } = renderHook(() => useOperationsStatus({ refreshMs: 20 }))
        await new Promise(resolve => setTimeout(resolve, 60))
        expect(mocks.get).not.toHaveBeenCalled()
        visibility = 'visible'
        act(() => { document.dispatchEvent(new Event('visibilitychange')) })
        await waitFor(() => expect(result.current.status).toBe('failed'))
    })

    it('mempertahankan status terakhir bila permintaan berikutnya gagal', async () => {
        mocks.get.mockResolvedValueOnce({ data: { status: 'attention' } }).mockRejectedValue(new Error('jaringan'))
        const { result } = renderHook(() => useOperationsStatus({ refreshMs: 20 }))
        await waitFor(() => expect(result.current.status).toBe('attention'))
        await waitFor(() => expect(mocks.get.mock.calls.length).toBeGreaterThanOrEqual(2))
        expect(result.current.status).toBe('attention')
    })

    it('memakai status yang diumumkan halaman Monitoring tanpa permintaan tambahan', async () => {
        mocks.get.mockResolvedValue({ data: { status: 'attention' } })
        const { result } = renderHook(() => useOperationsStatus())
        await waitFor(() => expect(result.current.status).toBe('attention'))
        act(() => umumkanStatusOperasional('healthy'))
        expect(result.current.status).toBe('healthy')
        act(() => umumkanStatusOperasional('tidak dikenal'))
        expect(result.current.status).toBe('healthy')
        expect(mocks.get).toHaveBeenCalledTimes(1)
    })
})
