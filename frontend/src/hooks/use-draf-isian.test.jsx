import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDrafIsian } from './use-draf-isian'
import { bacaDrafIsian, hapusSemuaDrafIsian, kunciDrafIsian } from '@/lib/draf-isian'

const KUNCI = kunciDrafIsian({ userId: 'u-1', formulir: 'surat-masuk' })

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

describe('useDrafIsian', () => {
    it('menulis isian setelah jeda singkat dan menandainya tersimpan sementara', () => {
        const { result } = renderHook(() => useDrafIsian({ userId: 'u-1', formulir: 'surat-masuk', jedaMs: 500 }))
        act(() => result.current.simpanDraf({ formData: { perihal: 'Pertama' } }))
        act(() => result.current.simpanDraf({ formData: { perihal: 'Kedua' } }))
        expect(bacaDrafIsian(KUNCI)).toBeNull()
        act(() => vi.advanceTimersByTime(500))
        expect(bacaDrafIsian(KUNCI).data).toEqual({ formData: { perihal: 'Kedua' } })
        expect(result.current.status).toBe('tersimpan')
    })

    it('menulis isian yang tertunda saat formulir ditutup atau halaman ditinggalkan', () => {
        const pertama = renderHook(() => useDrafIsian({ userId: 'u-1', formulir: 'surat-masuk' }))
        act(() => pertama.result.current.simpanDraf({ formData: { perihal: 'Sebelum sesi berakhir' } }))
        pertama.unmount()
        expect(bacaDrafIsian(KUNCI).data.formData.perihal).toBe('Sebelum sesi berakhir')

        const kedua = renderHook(() => useDrafIsian({ userId: 'u-1', formulir: 'surat-masuk' }))
        act(() => kedua.result.current.simpanDraf({ formData: { perihal: 'Sebelum dimuat ulang' } }))
        act(() => { window.dispatchEvent(new Event('pagehide')) })
        expect(bacaDrafIsian(KUNCI).data.formData.perihal).toBe('Sebelum dimuat ulang')
    })

    it('tidak menulis lagi setelah pengguna keluar', () => {
        const { result, unmount } = renderHook(() => useDrafIsian({ userId: 'u-1', formulir: 'surat-masuk' }))
        act(() => result.current.simpanDraf({ formData: { perihal: 'Tertunda saat keluar' } }))
        hapusSemuaDrafIsian()
        unmount()
        expect(bacaDrafIsian(KUNCI)).toBeNull()
    })

    it('hapusDraf membatalkan penulisan tertunda dan menghapus draf', () => {
        const { result, unmount } = renderHook(() => useDrafIsian({ userId: 'u-1', formulir: 'surat-masuk' }))
        act(() => {
            result.current.simpanDraf({ formData: { perihal: 'Tersimpan' } })
            vi.advanceTimersByTime(1000)
        })
        act(() => result.current.simpanDraf({ formData: { perihal: 'Tertunda' } }))
        act(() => result.current.hapusDraf())
        unmount()
        expect(bacaDrafIsian(KUNCI)).toBeNull()
    })

    it('isian yang tertunda tetap milik rekod tempat isian itu diketik', () => {
        const { result, rerender } = renderHook(({ idRekod }) => useDrafIsian({ userId: 'u-1', formulir: 'surat-masuk', idRekod }), {
            initialProps: { idRekod: 'sm-a' },
        })
        act(() => result.current.simpanDraf({ formData: { perihal: 'Perubahan surat A' } }))
        rerender({ idRekod: undefined })
        act(() => vi.advanceTimersByTime(1000))
        expect(bacaDrafIsian(KUNCI)).toBeNull()
        expect(bacaDrafIsian(kunciDrafIsian({ userId: 'u-1', formulir: 'surat-masuk', idRekod: 'sm-a' })).data.formData.perihal)
            .toBe('Perubahan surat A')
    })
})
