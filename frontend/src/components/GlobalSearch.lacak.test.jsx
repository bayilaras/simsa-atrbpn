import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ search: vi.fn(), apiGet: vi.fn(), lacak: vi.fn(), onOpenChange: vi.fn() }))
vi.mock('@/services/search.service', () => ({ default: { search: mocks.search } }))
vi.mock('@/services/api', () => ({ default: { get: mocks.apiGet }, api: { get: mocks.apiGet } }))
vi.mock('@/services/rangkaian.service', () => ({ default: { lacak: mocks.lacak }, rangkaianService: { lacak: mocks.lacak } }))
import { GlobalSearch } from './GlobalSearch'

const hasilPencarian = {
    counts: { surat_masuk: 1, surat_keluar: 1, arsip: 1, dosir: 0, total: 3 },
    results: [
        { type: 'surat_masuk', id: 'sm-1', title: 'B-12/PTPP.1/IX/2024', subtitle: 'Kanwil Jawa Barat', excerpt: 'Undangan rapat koordinasi' },
        { type: 'surat_keluar', id: 'sk-1', title: 'SK-7/2026', subtitle: 'Kepala Kantor', excerpt: 'Penjelasan Keputusan Nomor 5' },
        { type: 'arsip', id: 'ar-1', title: 'ARS-1', subtitle: '000.1', excerpt: 'Arsip' },
    ],
}
let router

beforeEach(() => {
    vi.clearAllMocks()
    mocks.search.mockResolvedValue(hasilPencarian)
    Element.prototype.scrollIntoView = vi.fn()
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.useRealTimers() })

async function bukaDanCari(q) {
    router = createMemoryRouter([
        { path: '/', element: <GlobalSearch open onOpenChange={mocks.onOpenChange} /> },
        { path: '/surat/lacak', element: <h1>Halaman Lacak</h1> },
        { path: '/surat/masuk/:id', element: <h1>Detail surat masuk</h1> },
    ])
    render(<RouterProvider router={router} />)
    vi.useFakeTimers()
    fireEvent.change(screen.getByRole('combobox', { name: 'Cari surat, arsip, dan dosir' }), { target: { value: q } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    vi.useRealTimers()
    await screen.findByRole('option', { name: /B-12\/PTPP\.1\/IX\/2024/ })
}
const qDiUrl = () => new URLSearchParams(router.state.location.search).get('q')
const tanpaRequestTambahan = () => {
    expect(mocks.search).toHaveBeenCalledTimes(1)
    expect(mocks.apiGet).not.toHaveBeenCalled()
    expect(mocks.lacak).not.toHaveBeenCalled()
}
// [P4-T15-1] Tombol "Lihat rangkaian" tidak lagi berada di dalam setiap opsi listbox
// (anak role="listbox" hanya boleh berupa option), melainkan satu tombol aksi yang
// mengikuti opsi aktif. Pindahkan opsi aktif dengan ArrowDown sebelum mengklik.
const pindahKeOpsi = (langkah) => {
    const combobox = screen.getByRole('combobox', { name: 'Cari surat, arsip, dan dosir' })
    for (let i = 0; i < langkah; i += 1) {
        fireEvent.keyDown(combobox, { key: 'ArrowDown' })
    }
}

describe('GlobalSearch → Lacak Surat', () => {
    it('Lihat rangkaian pada opsi aktif membuka /surat/lacak?q=<nomor> tanpa permintaan tambahan', async () => {
        await bukaDanCari('B-12')
        expect(screen.getByRole('option', { name: /B-12\/PTPP\.1\/IX\/2024/ })).toHaveAttribute('aria-selected', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'Lihat rangkaian untuk B-12/PTPP.1/IX/2024' }))
        expect(mocks.onOpenChange).toHaveBeenCalledWith(false)
        expect(router.state.location.pathname).toBe('/surat/lacak')
        expect(qDiUrl()).toBe('B-12/PTPP.1/IX/2024')
        tanpaRequestTambahan()
    })

    it('judul cadangan SK-n/yyyy memakai perihal sebagai kueri', async () => {
        await bukaDanCari('B-12')
        pindahKeOpsi(1)
        fireEvent.click(screen.getByRole('button', { name: 'Lihat rangkaian untuk SK-7/2026' }))
        expect(qDiUrl()).toBe('Penjelasan Keputusan Nomor 5')
        tanpaRequestTambahan()
    })

    it('hasil arsip tidak mendapat aksi Lihat rangkaian', async () => {
        await bukaDanCari('B-12')
        pindahKeOpsi(2)
        expect(screen.getByRole('option', { name: /ARS-1/ })).toHaveAttribute('aria-selected', 'true')
        expect(screen.queryByRole('button', { name: /Lihat rangkaian/ })).toBeNull()
    })

    it('tombol Lihat rangkaian bukan anak dari listbox hasil pencarian (ARIA)', async () => {
        await bukaDanCari('B-12')
        const listbox = screen.getByRole('listbox', { name: 'Hasil pencarian' })
        const tombol = screen.getByRole('button', { name: 'Lihat rangkaian untuk B-12/PTPP.1/IX/2024' })
        expect(listbox.contains(tombol)).toBe(false)
    })

    it('Shift+Enter melacak opsi terpilih, Enter tetap membuka detail', async () => {
        await bukaDanCari('B-12')
        const combobox = screen.getByRole('combobox', { name: 'Cari surat, arsip, dan dosir' })
        fireEvent.keyDown(combobox, { key: 'Enter', shiftKey: true })
        expect(router.state.location.pathname).toBe('/surat/lacak')
        expect(qDiUrl()).toBe('B-12/PTPP.1/IX/2024')
        tanpaRequestTambahan()
    })

    it('Enter tanpa Shift tetap ke detail surat', async () => {
        await bukaDanCari('B-12')
        fireEvent.keyDown(screen.getByRole('combobox', { name: 'Cari surat, arsip, dan dosir' }), { key: 'Enter' })
        expect(router.state.location.pathname).toBe('/surat/masuk/sm-1')
    })

    it('item Lacak rangkaian “q” meneruskan kueri yang diketik', async () => {
        await bukaDanCari('B-12')
        fireEvent.click(screen.getByRole('button', { name: 'Lacak rangkaian “B-12”' }))
        expect(router.state.location.pathname).toBe('/surat/lacak')
        expect(qDiUrl()).toBe('B-12')
        tanpaRequestTambahan()
    })
})
