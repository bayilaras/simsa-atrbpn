import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ lacak: vi.fn() }))
vi.mock('@/services/rangkaian.service', () => ({ rangkaianService: { lacak: mocks.lacak }, default: { lacak: mocks.lacak } }))
const { useLacakSearch } = await import('./use-lacak-search')

const hasil = (q) => ({ q, mode: 'referensi', jenisKueri: 'nomor', kelompok: [] })

beforeEach(() => {
    vi.useFakeTimers()
    mocks.lacak.mockReset().mockImplementation(async ({ q }) => hasil(q))
})
afterEach(() => vi.useRealTimers())

describe('useLacakSearch', () => {
    it('debounce 300 ms, minimal 3 karakter, satu permintaan untuk ketikan beruntun', async () => {
        const { result, rerender } = renderHook(({ term }) => useLacakSearch(term, { mode: 'referensi' }), { initialProps: { term: 'ab' } })
        await act(async () => { await vi.advanceTimersByTimeAsync(400) })
        expect(mocks.lacak).not.toHaveBeenCalled()
        rerender({ term: 'B-1' })
        await act(async () => { await vi.advanceTimersByTimeAsync(200) })
        rerender({ term: 'B-12' })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        expect(mocks.lacak).toHaveBeenCalledTimes(1)
        expect(mocks.lacak).toHaveBeenCalledWith({ q: 'B-12', mode: 'referensi', jenis: undefined, tahun: undefined }, { signal: expect.any(AbortSignal) })
        expect(result.current.data).toEqual(hasil('B-12'))
    })

    it('membatalkan permintaan lama dan mengabaikan respons basi', async () => {
        let selesaiLama
        mocks.lacak.mockImplementationOnce(({ q }, { signal }) => new Promise((resolve) => { selesaiLama = () => resolve(hasil(q)); signal.addEventListener('abort', () => {}) }))
        const { result, rerender } = renderHook(({ term }) => useLacakSearch(term), { initialProps: { term: 'lama sekali' } })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        const sinyalLama = mocks.lacak.mock.calls[0][1].signal
        rerender({ term: 'baru saja' })
        expect(sinyalLama.aborted).toBe(true)
        await act(async () => { selesaiLama() })
        expect(result.current.loading).toBe(true)
        expect(result.current.data).toBeNull()
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        expect(result.current.data.q).toBe('baru saja')
    })

    it('mengabaikan AbortError dari permintaan basi dan tidak menampilkan gagal untuk kueri yang sama', async () => {
        mocks.lacak.mockImplementationOnce((_arg, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }))
        const { result, rerender } = renderHook(({ term }) => useLacakSearch(term), { initialProps: { term: 'lama sekali' } })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        rerender({ term: 'baru saja' })
        await act(async () => {})
        rerender({ term: 'lama sekali' })
        expect(result.current.error).toBeNull()
        expect(result.current.loading).toBe(true)
    })

    it('tidak menampilkan hasil kueri lama saat kueri baru sedang memuat', async () => {
        const { result, rerender } = renderHook(({ term }) => useLacakSearch(term), { initialProps: { term: 'Nota dinas' } })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        expect(result.current.data).toEqual(hasil('Nota dinas'))
        rerender({ term: '' })
        rerender({ term: 'B-12' })
        expect(result.current.loading).toBe(true)
        expect(result.current.data).toBeNull()
    })

    it('memakai cache untuk kueri yang sama', async () => {
        const { rerender } = renderHook(({ term }) => useLacakSearch(term), { initialProps: { term: 'Nota dinas' } })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        rerender({ term: 'Nota dinas x' })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        rerender({ term: 'Nota dinas' })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        expect(mocks.lacak).toHaveBeenCalledTimes(2)
    })
})
