import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Dosir from './Dosir'

const mocks = vi.hoisted(() => ({ user: {}, getAll: vi.fn(), getStats: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: async () => [] } }))
vi.mock('@/services/dosir.service', () => ({ default: { getAll: mocks.getAll, getStats: mocks.getStats } }))

function deferred() {
    let resolve, reject
    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail })
    return { promise, resolve, reject }
}
function pendingList() {
    const list = deferred()
    mocks.getAll.mockReturnValueOnce(list.promise)
    return {
        async resolve(title) {
            await act(async () => { list.resolve([{ id: title, kode: `QA-${title}`, judul: title, status: 'open' }]) })
        },
        async reject() {
            await act(async () => { list.reject(new Error('Temporary API outage')) })
        },
    }
}
function pendingStats() {
    const stats = deferred()
    mocks.getStats.mockReturnValueOnce(stats.promise)
    return {
        async resolve(total) {
            await act(async () => { stats.resolve({ total, open: total, closed: 0, archived: 0 }) })
        },
    }
}
// Search is debounced by 300 ms; leave room for that on a busy test worker.
const SETTLED = { timeout: 3000 }
function mount() { return render(<MemoryRouter><Dosir /></MemoryRouter>) }
function search(value) {
    fireEvent.change(screen.getByPlaceholderText('Cari judul, kode, atau deskripsi dosir...'), { target: { value } })
}
beforeEach(() => {
    mocks.user = { id: 'admin-a', role: 'admin_unit', unitKerjaId: 'ditjen' }
    mocks.getAll.mockReset()
    mocks.getStats.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Dosir requests follow the current unit and filters', () => {
    it('keeps the newest search list when an older request succeeds later, without refetching unit statistics', async () => {
        const stats = pendingStats(), old = pendingList(), current = pendingList()
        mount()
        search('terbaru')
        await waitFor(() => expect(mocks.getAll).toHaveBeenCalledTimes(2), SETTLED)
        await current.resolve('Dosir terbaru')
        expect(screen.getByText('Dosir terbaru')).toBeInTheDocument()
        await old.resolve('Dosir lama')
        expect(screen.getByText('Dosir terbaru')).toBeInTheDocument()
        expect(screen.queryByText('Dosir lama')).not.toBeInTheDocument()
        await stats.resolve(222)
        expect(screen.getAllByText('222').length).toBeGreaterThan(0)
        expect(mocks.getStats).toHaveBeenCalledOnce()
    })

    it('sends one list request for a typed search', async () => {
        pendingStats()
        const initial = pendingList()
        mount()
        await initial.resolve('Awal')
        mocks.getAll.mockResolvedValue([])
        for (const value of ['p', 'pe', 'per', 'perk', 'perkara']) search(value)
        await waitFor(() => expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'perkara' })), SETTLED)
        expect(mocks.getAll).toHaveBeenCalledTimes(2)
    })

    it('hides prior unit results and counts during loading, then ignores the late old-unit response', async () => {
        const initialStats = pendingStats(), initial = pendingList()
        const view = mount()
        await initial.resolve('Ditjen awal')
        await initialStats.resolve(333)
        const old = pendingList()
        search('perkara')
        await waitFor(() => expect(mocks.getAll).toHaveBeenCalledTimes(2), SETTLED)
        expect(screen.queryByText('Ditjen awal')).not.toBeInTheDocument()
        // Unit totals do not depend on the search text.
        expect(screen.getAllByText('333').length).toBeGreaterThan(0)
        const current = pendingList(), currentStats = pendingStats()
        mocks.user = { id: 'admin-b', role: 'admin_unit', unitKerjaId: 'sesditjen' }
        view.rerender(<MemoryRouter><Dosir /></MemoryRouter>)
        await waitFor(() => expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ unitKerjaId: 'sesditjen', search: 'perkara' })))
        expect(mocks.getStats).toHaveBeenLastCalledWith('sesditjen')
        expect(screen.queryAllByText('333')).toHaveLength(0)
        await current.resolve('Sesditjen terbaru')
        await currentStats.resolve(444)
        await old.resolve('Ditjen terlambat')
        expect(screen.getByText('Sesditjen terbaru')).toBeInTheDocument()
        expect(screen.queryByText('Ditjen terlambat')).not.toBeInTheDocument()
        expect(screen.getAllByText('444').length).toBeGreaterThan(0)
    })

    it('keeps the newest failure visible after an old success and retries only the current search', async () => {
        pendingStats()
        const old = pendingList(), current = pendingList()
        mount()
        search('gagal terbaru')
        await waitFor(() => expect(mocks.getAll).toHaveBeenCalledTimes(2), SETTLED)
        await current.reject()
        expect(await screen.findByRole('alert')).toHaveTextContent(/dosir.*muat/i)
        await old.resolve('Lama sesudah gagal')
        expect(screen.getByRole('alert')).toBeInTheDocument()
        expect(screen.queryByText('Lama sesudah gagal')).not.toBeInTheDocument()
        expect(screen.queryByText('Belum ada dosir')).not.toBeInTheDocument()
        const retry = pendingList()
        pendingStats()
        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
        await waitFor(() => expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'gagal terbaru' })))
        await retry.resolve('Hasil percobaan ulang')
        expect(screen.getByText('Hasil percobaan ulang')).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('offers the next page because the list endpoint returns no total', async () => {
        mocks.getStats.mockResolvedValue({ total: 51, open: 51, closed: 0, archived: 0 })
        const row = index => ({ id: `d${index}`, kode: `QA-${index}`, judul: `Dosir nomor ${index}`, status: 'open' })
        mocks.getAll.mockResolvedValueOnce(Array.from({ length: 51 }, (_, index) => row(index)))
            .mockResolvedValueOnce([row(50)])
        mount()
        expect(await screen.findByText('Dosir nomor 49')).toBeInTheDocument()
        expect(screen.queryByText('Dosir nomor 50')).not.toBeInTheDocument()
        expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 51, offset: 0 }))
        fireEvent.click(screen.getByRole('button', { name: 'Muat lebih banyak' }))
        expect(await screen.findByText('Dosir nomor 50')).toBeInTheDocument()
        expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 51, offset: 50 }))
        expect(screen.getByText('Dosir nomor 0')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Muat lebih banyak' })).not.toBeInTheDocument()
    })
})
