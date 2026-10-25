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
function pendingQuery() {
    const list = deferred(), stats = deferred()
    mocks.getAll.mockReturnValueOnce(list.promise)
    mocks.getStats.mockReturnValueOnce(stats.promise)
    return {
        async resolve(title, total) {
            await act(async () => {
                list.resolve([{ id: title, kode: `QA-${title}`, judul: title, status: 'open' }])
                stats.resolve({ total, open: total, closed: 0, archived: 0 })
            })
        },
        async reject() {
            await act(async () => { list.reject(new Error('Temporary API outage')); stats.resolve({ total: 999 }) })
        },
    }
}
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
    it('keeps the newest search list and statistics when an older request succeeds later', async () => {
        const old = pendingQuery(), current = pendingQuery()
        mount()
        search('terbaru')
        await waitFor(() => expect(mocks.getAll).toHaveBeenCalledTimes(2))
        await current.resolve('Dosir terbaru', 222)
        expect(screen.getByText('Dosir terbaru')).toBeInTheDocument()
        await old.resolve('Dosir lama', 111)
        expect(screen.getByText('Dosir terbaru')).toBeInTheDocument()
        expect(screen.queryByText('Dosir lama')).not.toBeInTheDocument()
        expect(screen.queryAllByText('111')).toHaveLength(0)
    })

    it('hides prior unit results and counts during loading, then ignores the late old-unit response', async () => {
        const initial = pendingQuery(), old = pendingQuery(), current = pendingQuery()
        const view = mount()
        await initial.resolve('Ditjen awal', 333)
        search('perkara')
        await waitFor(() => expect(mocks.getAll).toHaveBeenCalledTimes(2))
        expect(screen.queryByText('Ditjen awal')).not.toBeInTheDocument()
        expect(screen.queryAllByText('333')).toHaveLength(0)
        mocks.user = { id: 'admin-b', role: 'admin_unit', unitKerjaId: 'sesditjen' }
        view.rerender(<MemoryRouter><Dosir /></MemoryRouter>)
        await waitFor(() => expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ unitKerjaId: 'sesditjen', search: 'perkara' })))
        await current.resolve('Sesditjen terbaru', 444)
        await old.resolve('Ditjen terlambat', 555)
        expect(screen.getByText('Sesditjen terbaru')).toBeInTheDocument()
        expect(screen.queryByText('Ditjen terlambat')).not.toBeInTheDocument()
        expect(screen.queryAllByText('555')).toHaveLength(0)
    })

    it('keeps the newest failure visible after an old success and retries only the current search', async () => {
        const old = pendingQuery(), current = pendingQuery(), retry = pendingQuery()
        mount()
        search('gagal terbaru')
        await current.reject()
        expect(await screen.findByRole('alert')).toHaveTextContent(/dosir.*muat/i)
        await old.resolve('Lama sesudah gagal', 666)
        expect(screen.getByRole('alert')).toBeInTheDocument()
        expect(screen.queryByText('Lama sesudah gagal')).not.toBeInTheDocument()
        expect(screen.queryByText('Belum ada dosir')).not.toBeInTheDocument()
        expect(screen.queryAllByText('666')).toHaveLength(0)
        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
        await waitFor(() => expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'gagal terbaru' })))
        await retry.resolve('Hasil percobaan ulang', 777)
        expect(screen.getByText('Hasil percobaan ulang')).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
})
