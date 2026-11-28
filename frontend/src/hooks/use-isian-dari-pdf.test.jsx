import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIsianDariPdf } from './use-isian-dari-pdf'

const mocks = vi.hoisted(() => ({ bacaTeksPdf: vi.fn(), bacaIsian: vi.fn() }))
vi.mock('@/lib/teks-pdf', () => ({ bacaTeksPdf: mocks.bacaTeksPdf }))
vi.mock('@/services/letter-prefill.service', () => ({ letterPrefillService: { bacaIsian: mocks.bacaIsian } }))

const berkas = (nama) => new File(['%PDF-1.4'], nama, { type: 'application/pdf' })
const tunda = () => {
    let selesaikan
    let tolak
    const janji = new Promise((resolve, reject) => { selesaikan = resolve; tolak = reject })
    return { janji, selesaikan, tolak }
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.bacaTeksPdf.mockResolvedValue('Nomor : 1/CTH/XI/2026')
    mocks.bacaIsian.mockResolvedValue({ nomorSurat: '1/CTH/XI/2026' })
})
afterEach(cleanup)

describe('useIsianDariPdf', () => {
    it('diam dan tidak membaca apa pun bila modul tidak aktif atau belum ada berkas', () => {
        const { result, rerender } = renderHook(props => useIsianDariPdf(props), { initialProps: { aktif: false, berkas: berkas('a.pdf') } })
        expect(result.current).toEqual({ status: 'diam', terbaca: null })
        rerender({ aktif: true, berkas: null })
        expect(result.current).toEqual({ status: 'diam', terbaca: null })
        expect(mocks.bacaTeksPdf).not.toHaveBeenCalled()
        expect(mocks.bacaIsian).not.toHaveBeenCalled()
    })

    it('membaca teks di peramban lalu mengirim teksnya, bukan berkasnya, ke server', async () => {
        const pdf = berkas('surat.pdf')
        const { result } = renderHook(() => useIsianDariPdf({ aktif: true, berkas: pdf }))
        expect(result.current.status).toBe('membaca')
        await waitFor(() => expect(result.current.status).toBe('siap'))
        expect(result.current.terbaca).toEqual({ nomorSurat: '1/CTH/XI/2026' })
        expect(mocks.bacaTeksPdf).toHaveBeenCalledWith(pdf, { signal: expect.any(AbortSignal) })
        expect(mocks.bacaIsian).toHaveBeenCalledWith('Nomor : 1/CTH/XI/2026', { signal: expect.any(AbortSignal) })
    })

    it('PDF tanpa teks tidak dikirim ke server', async () => {
        mocks.bacaTeksPdf.mockResolvedValue('')
        const pdf = berkas('pindai.pdf')
        const { result } = renderHook(() => useIsianDariPdf({ aktif: true, berkas: pdf }))
        await waitFor(() => expect(result.current.status).toBe('tanpa-teks'))
        expect(mocks.bacaIsian).not.toHaveBeenCalled()
    })

    it.each([
        ['PDF tidak dapat dibuka', () => mocks.bacaTeksPdf.mockRejectedValue(new Error('rusak'))],
        ['server menolak', () => mocks.bacaIsian.mockRejectedValue(new Error('503'))],
    ])('gagal dengan tenang bila %s', async (_nama, siapkan) => {
        siapkan()
        const pdf = berkas('surat.pdf')
        const { result } = renderHook(() => useIsianDariPdf({ aktif: true, berkas: pdf }))
        await waitFor(() => expect(result.current.status).toBe('gagal'))
        expect(result.current.terbaca).toBeNull()
    })

    it('berkas pengganti membatalkan pembacaan lama dan hasil lama tidak pernah tampil', async () => {
        const lama = tunda()
        mocks.bacaTeksPdf.mockReturnValueOnce(lama.janji)
        const pertama = berkas('lama.pdf')
        const kedua = berkas('baru.pdf')
        const { result, rerender } = renderHook(props => useIsianDariPdf(props), { initialProps: { aktif: true, berkas: pertama } })
        const sinyalLama = mocks.bacaTeksPdf.mock.calls[0][1].signal

        mocks.bacaIsian.mockResolvedValue({ nomorSurat: '2/CTH/XI/2026' })
        rerender({ aktif: true, berkas: kedua })
        expect(sinyalLama.aborted).toBe(true)
        expect(result.current.status).toBe('membaca')
        await waitFor(() => expect(result.current.status).toBe('siap'))
        expect(result.current.terbaca).toEqual({ nomorSurat: '2/CTH/XI/2026' })

        await act(async () => { lama.selesaikan('Nomor : 99/LAMA/XI/2026') })
        expect(result.current.terbaca).toEqual({ nomorSurat: '2/CTH/XI/2026' })
        expect(mocks.bacaIsian).toHaveBeenCalledTimes(1)
    })

    it('menghapus berkas mengembalikan keadaan diam', async () => {
        const { result, rerender } = renderHook(props => useIsianDariPdf(props), { initialProps: { aktif: true, berkas: berkas('surat.pdf') } })
        await waitFor(() => expect(result.current.status).toBe('siap'))
        rerender({ aktif: true, berkas: null })
        expect(result.current).toEqual({ status: 'diam', terbaca: null })
    })
})
