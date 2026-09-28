import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ ringkasan: vi.fn() }))
vi.mock('@/services/rangkaian.service', () => {
    const service = { ringkasanPerluDilengkapi: mocks.ringkasan }
    return { default: service, rangkaianService: service }
})
import { usePerluDilengkapiCount } from './use-perlu-dilengkapi-count'
import { PERLU_DILENGKAPI_EVENT, PERLU_DILENGKAPI_REFRESH_MS } from '@/lib/perlu-dilengkapi'

let visibilitas = 'visible'
const tunggu = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(() => {
    vi.useFakeTimers()
    visibilitas = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibilitas })
    mocks.ringkasan.mockReset()
    mocks.ringkasan.mockResolvedValue({ total: 12 })
})
afterEach(() => {
    vi.useRealTimers()
    delete document.visibilityState
})

describe('usePerluDilengkapiCount', () => {
    it('tidak meminta apa pun bila dinonaktifkan (role read-only)', async () => {
        const { result } = renderHook(() => usePerluDilengkapiCount({ enabled: false }))
        await tunggu(PERLU_DILENGKAPI_REFRESH_MS * 3)
        expect(mocks.ringkasan).not.toHaveBeenCalled()
        expect(result.current.total).toBe(0)
    })

    it('memuat saat mount, lalu paling sering sekali per 60 detik dan hanya saat tab terlihat', async () => {
        const { result } = renderHook(() => usePerluDilengkapiCount())
        await tunggu(0)
        expect(result.current.total).toBe(12)
        expect(mocks.ringkasan).toHaveBeenCalledTimes(1)
        expect(mocks.ringkasan).toHaveBeenCalledWith({}, { signal: expect.any(AbortSignal) })
        await tunggu(PERLU_DILENGKAPI_REFRESH_MS - 1)
        expect(mocks.ringkasan).toHaveBeenCalledTimes(1)
        await tunggu(1)
        expect(mocks.ringkasan).toHaveBeenCalledTimes(2)

        visibilitas = 'hidden'
        await tunggu(PERLU_DILENGKAPI_REFRESH_MS * 2)
        expect(mocks.ringkasan).toHaveBeenCalledTimes(2)

        visibilitas = 'visible'
        act(() => { document.dispatchEvent(new Event('visibilitychange')) })
        expect(mocks.ringkasan).toHaveBeenCalledTimes(3)
        act(() => { document.dispatchEvent(new Event('visibilitychange')) })
        expect(mocks.ringkasan).toHaveBeenCalledTimes(3)
    })

    it('memakai ringkasan yang diumumkan tab Perlu Dilengkapi tanpa request tambahan', async () => {
        const { result } = renderHook(() => usePerluDilengkapiCount())
        await tunggu(0)
        act(() => { window.dispatchEvent(new CustomEvent(PERLU_DILENGKAPI_EVENT, { detail: { total: 3 } })) })
        expect(result.current.total).toBe(3)
        expect(mocks.ringkasan).toHaveBeenCalledTimes(1)
    })

    it('mempertahankan nilai terakhir saat gagal dan membatalkan permintaan saat unmount', async () => {
        const { result, unmount } = renderHook(() => usePerluDilengkapiCount())
        await tunggu(0)
        mocks.ringkasan.mockRejectedValueOnce(new Error('Terlalu banyak permintaan'))
        await tunggu(PERLU_DILENGKAPI_REFRESH_MS)
        expect(result.current.total).toBe(12)
        mocks.ringkasan.mockReturnValueOnce(new Promise(() => {}))
        await tunggu(PERLU_DILENGKAPI_REFRESH_MS)
        const sinyal = mocks.ringkasan.mock.calls.at(-1)[1].signal
        unmount()
        expect(sinyal.aborted).toBe(true)
    })
})
