import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ lacak: vi.fn() }))
vi.mock('@/services/rangkaian.service', () => ({ default: { lacak: mocks.lacak }, rangkaianService: { lacak: mocks.lacak } }))
import { useLacakSearch } from './use-lacak-search'

const hasil = q => ({ q, mode: 'lacak', jenisKueri: 'nomor', kelompok: [{ kunci: `surat:${q}` }] })
function deferred() {
    let resolve
    const promise = new Promise(res => { resolve = res })
    return { promise, resolve }
}
const maju = async ms => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(() => {
    vi.useFakeTimers()
    mocks.lacak.mockReset()
    mocks.lacak.mockImplementation(async ({ q }) => hasil(q))
})
afterEach(() => vi.useRealTimers())

describe('useLacakSearch (P4: halaman Lacak Surat)', () => {
    it('menunggu 300 ms setelah ketikan terakhir dan hanya mengirim satu permintaan', async () => {
        const { result, rerender } = renderHook(({ q }) => useLacakSearch(q), { initialProps: { q: 'B-1' } })
        rerender({ q: 'B-12' })
        await maju(200)
        rerender({ q: 'B-12/' })
        await maju(299)
        expect(mocks.lacak).not.toHaveBeenCalled()
        expect(result.current.status).toBe('loading')
        expect(result.current.loading).toBe(true)
        await maju(1)
        expect(mocks.lacak).toHaveBeenCalledTimes(1)
        expect(mocks.lacak).toHaveBeenCalledWith({ q: 'B-12/', mode: 'lacak', jenis: undefined, tahun: undefined }, { signal: expect.any(AbortSignal) })
        expect(result.current.status).toBe('success')
        expect(result.current.loading).toBe(false)
        expect(result.current.data.kelompok[0].kunci).toBe('surat:B-12/')
    })

    it('tidak mengirim untuk < 3 karakter setelah trim dan menandai > 100 karakter tidak valid', async () => {
        const { result, rerender } = renderHook(({ q }) => useLacakSearch(q), { initialProps: { q: '  ab  ' } })
        await maju(1000)
        expect(result.current.status).toBe('idle')
        rerender({ q: 'x'.repeat(101) })
        await maju(1000)
        expect(result.current.status).toBe('invalid')
        expect(mocks.lacak).not.toHaveBeenCalled()
    })

    it('membatalkan permintaan lama begitu kueri berubah', async () => {
        const pertama = deferred()
        mocks.lacak.mockImplementationOnce(() => pertama.promise)
        const { result, rerender } = renderHook(({ q }) => useLacakSearch(q), { initialProps: { q: 'PTPP.1' } })
        await maju(300)
        const sinyal = mocks.lacak.mock.calls[0][1].signal
        expect(sinyal.aborted).toBe(false)
        rerender({ q: 'PTPP.12' })
        expect(sinyal.aborted).toBe(true)
        await maju(300)
        expect(result.current.data.q).toBe('PTPP.12')
        await act(async () => { pertama.resolve(hasil('PTPP.1')) })
        expect(result.current.data.q).toBe('PTPP.12')
    })

    it('penjaga urutan: respons basi yang tidak menghormati abort tidak menimpa hasil terbaru', async () => {
        const d1 = deferred()
        const d2 = deferred()
        mocks.lacak.mockImplementationOnce(() => d1.promise).mockImplementationOnce(() => d2.promise)
        const { result, rerender } = renderHook(({ q }) => useLacakSearch(q), { initialProps: { q: 'rapat' } })
        await maju(300)
        rerender({ q: 'rapat koordinasi' })
        await maju(300)
        await act(async () => { d2.resolve(hasil('rapat koordinasi')) })
        expect(result.current.data.q).toBe('rapat koordinasi')
        await act(async () => { d1.resolve(hasil('rapat')) })
        expect(result.current.status).toBe('success')
        expect(result.current.data.q).toBe('rapat koordinasi')
    })

    it('memakai cache LRU 20 entri: kembali ke kueri lama tanpa permintaan baru; entri terlama tak terpakai digusur', async () => {
        const kueri = i => `kueri-${String(i).padStart(2, '0')}`
        const { result, rerender } = renderHook(({ q }) => useLacakSearch(q), { initialProps: { q: kueri(0) } })
        await maju(300)
        for (let i = 1; i < 20; i += 1) {
            rerender({ q: kueri(i) })
            await maju(300)
        }
        expect(mocks.lacak).toHaveBeenCalledTimes(20)
        rerender({ q: kueri(0) })
        expect(result.current.status).toBe('success')
        await maju(300)
        expect(mocks.lacak).toHaveBeenCalledTimes(20)
        rerender({ q: kueri(20) })
        await maju(300)
        expect(mocks.lacak).toHaveBeenCalledTimes(21)
        rerender({ q: kueri(0) })
        await maju(300)
        expect(mocks.lacak).toHaveBeenCalledTimes(21)
        rerender({ q: kueri(1) })
        expect(result.current.status).toBe('loading')
        await maju(300)
        expect(mocks.lacak).toHaveBeenCalledTimes(22)
    })

    it('mode, tahun, dan jenis ikut menentukan kunci cache', async () => {
        const { rerender } = renderHook(({ tahun, jenis }) => useLacakSearch('SK-01/DJ-PTPP', { tahun, jenis }), { initialProps: { tahun: '', jenis: undefined } })
        await maju(300)
        rerender({ tahun: '2024', jenis: undefined })
        await maju(300)
        expect(mocks.lacak).toHaveBeenLastCalledWith({ q: 'SK-01/DJ-PTPP', mode: 'lacak', jenis: undefined, tahun: '2024' }, expect.anything())
        rerender({ tahun: '2024', jenis: 'surat_keluar' })
        await maju(300)
        expect(mocks.lacak).toHaveBeenCalledTimes(3)
        rerender({ tahun: '', jenis: undefined })
        await maju(300)
        expect(mocks.lacak).toHaveBeenCalledTimes(3)
    })

    it('enabled=false (pemanggil P3) tidak pernah mengirim permintaan', async () => {
        const { result } = renderHook(() => useLacakSearch('rapat koordinasi', { enabled: false }))
        await maju(1000)
        expect(result.current).toMatchObject({ status: 'idle', loading: false, data: null })
        expect(mocks.lacak).not.toHaveBeenCalled()
    })

    it('galat ditampilkan lalu dapat diulang', async () => {
        mocks.lacak.mockRejectedValueOnce(new Error('Terlalu banyak permintaan. Coba lagi nanti.'))
        const { result } = renderHook(() => useLacakSearch('rapat'))
        await maju(300)
        expect(result.current.status).toBe('error')
        expect(result.current.error.message).toBe('Terlalu banyak permintaan. Coba lagi nanti.')
        act(() => result.current.retry())
        expect(result.current.status).toBe('loading')
        await maju(300)
        expect(result.current.status).toBe('success')
    })
})

describe('useLacakSearch (kontrak P3 T18-2 dipertahankan)', () => {
    it('selama loading kueri baru, data null (kontrak P3 986e7b5)', async () => {
        const { result, rerender } = renderHook(({ q }) => useLacakSearch(q), { initialProps: { q: 'rapat' } })
        await maju(300)
        expect(result.current.data.q).toBe('rapat')
        rerender({ q: 'rapat koordinasi' })
        expect(result.current.status).toBe('loading')
        expect(result.current.loading).toBe(true)
        expect(result.current.data).toBeNull()
        await maju(300)
        expect(result.current.status).toBe('success')
        expect(result.current.data.q).toBe('rapat koordinasi')
    })
})
