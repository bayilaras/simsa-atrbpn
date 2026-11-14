import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AppConfigContext } from '@/context/app-config-context'

const mocks = vi.hoisted(() => ({ search: vi.fn(), onOpenChange: vi.fn() }))
vi.mock('@/services/search.service', () => ({ default: { search: mocks.search } }))
import { GlobalSearch } from './GlobalSearch'

const CAKUPAN = 'Pencarian mencakup data surat dan arsip yang dicatat, tidak termasuk isi PDF hasil pindaian.'

const hasil = (dari, sampai) => Array.from({ length: sampai - dari + 1 }, (_, i) => ({
    type: 'surat_masuk', id: `sm-${dari + i}`, title: `SM-${dari + i}/2026`, subtitle: 'Pengirim', excerpt: `Undangan ${dari + i}`,
}))
const halaman = (page, results, total, hasMore) => ({
    results,
    counts: { surat_masuk: total, surat_keluar: 0, arsip: 0, dosir: 0, total },
    pagination: { page, limit: 10, total, hasMore },
})

beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
})

function tampilkan(capabilities) {
    const isi = <MemoryRouter><GlobalSearch open onOpenChange={mocks.onOpenChange} /></MemoryRouter>
    return render(capabilities
        ? <AppConfigContext.Provider value={{ capabilities, features: {}, authentication: {}, compatible: true, loading: false, checking: false }}>{isi}</AppConfigContext.Provider>
        : isi)
}

async function cari(q) {
    vi.useFakeTimers()
    fireEvent.change(screen.getByRole('combobox', { name: 'Cari surat, arsip, dan dosir' }), { target: { value: q } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    vi.useRealTimers()
}

describe('pencarian global: Tampilkan lebih banyak', () => {
    it('memuat halaman berikutnya dengan kata kunci yang sama dan menambahkannya ke daftar', async () => {
        mocks.search
            .mockResolvedValueOnce(halaman(1, hasil(1, 10), 12, true))
            .mockResolvedValueOnce(halaman(2, hasil(11, 12), 12, false))
        tampilkan()
        await cari('undangan')
        expect(await screen.findAllByRole('option')).toHaveLength(10)
        expect(screen.getByText('Menampilkan 10 dari 12 hasil.')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Tampilkan lebih banyak' }))
        await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(12))
        expect(mocks.search).toHaveBeenLastCalledWith('undangan', { limit: 10, page: 2 })
        expect(screen.getByRole('option', { name: /SM-12\/2026/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Tampilkan lebih banyak' })).not.toBeInTheDocument()
        expect(screen.queryByText(/Menampilkan/)).not.toBeInTheDocument()

        // Navigasi papan ketik menjangkau hasil tambahan.
        const kotak = screen.getByRole('combobox', { name: 'Cari surat, arsip, dan dosir' })
        for (let i = 0; i < 11; i += 1) fireEvent.keyDown(kotak, { key: 'ArrowDown' })
        expect(screen.getByRole('option', { name: /SM-12\/2026/ })).toHaveAttribute('aria-selected', 'true')
    })

    it('tanpa halaman berikutnya meminta pengguna mempersempit kata pencarian', async () => {
        mocks.search.mockResolvedValueOnce(halaman(100, hasil(1, 10), 1500, false))
        tampilkan()
        await cari('surat')
        await screen.findAllByRole('option')
        expect(screen.getByText('Menampilkan 10 dari 1500 hasil. Persempit kata pencarian untuk melihat hasil lainnya.')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Tampilkan lebih banyak' })).not.toBeInTheDocument()
    })

    it('kegagalan memuat halaman berikutnya tidak menghapus hasil yang sudah tampil', async () => {
        mocks.search
            .mockResolvedValueOnce(halaman(1, hasil(1, 10), 12, true))
            .mockRejectedValueOnce(new Error('jaringan putus'))
        tampilkan()
        await cari('undangan')
        await screen.findAllByRole('option')
        fireEvent.click(screen.getByRole('button', { name: 'Tampilkan lebih banyak' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Hasil berikutnya gagal dimuat. Coba lagi.')
        expect(screen.getAllByRole('option')).toHaveLength(10)
        expect(screen.getByRole('button', { name: 'Tampilkan lebih banyak' })).toBeEnabled()
    })
})

describe('keterangan cakupan pencarian', () => {
    it('tampil saat OCR massal tidak aktif, juga ketika tidak ada hasil', async () => {
        mocks.search.mockResolvedValueOnce(halaman(1, [], 0, false))
        tampilkan({ metadata: true, files: true, fileUploads: true, externalIntegrations: false, bulkOcr: false })
        expect(screen.getByText(CAKUPAN)).toBeInTheDocument()
        await cari('kata di dalam pdf')
        expect(await screen.findByText(/Tidak ada hasil untuk/)).toBeInTheDocument()
        expect(screen.getByText(CAKUPAN)).toBeInTheDocument()
    })

    it('tidak tampil saat OCR massal aktif', () => {
        tampilkan({ metadata: true, files: true, fileUploads: true, externalIntegrations: false, bulkOcr: true })
        expect(screen.getByText('Ketik minimal 2 karakter untuk mencari')).toBeInTheDocument()
        expect(screen.queryByText(CAKUPAN)).not.toBeInTheDocument()
    })
})
