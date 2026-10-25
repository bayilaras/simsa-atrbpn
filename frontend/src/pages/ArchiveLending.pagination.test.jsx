import { act, cleanup, fireEvent, render as renderUI, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ArchiveLending from './ArchiveLending'

const mocks = vi.hoisted(() => ({
    user: { role: 'admin_unit', unitKerjaId: 'unit-a' },
    getAll: vi.fn(), getStats: vi.fn(), return: vi.fn(), extend: vi.fn(), borrow: vi.fn(), toast: vi.fn(), getUnits: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/archive-lending.service', () => ({ default: mocks }))
vi.mock('@/services/arsip.service', () => ({ default: { search: vi.fn() } }))
vi.mock('@/services/storage-location.service', () => ({ default: { getAll: vi.fn() } }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: mocks.getUnits } }))

function LocationProbe() { return <output aria-label="Lokasi uji">{useLocation().search}</output> }
function render(ui, route = '/archive-lending') {
    return renderUI(ui, { wrapper: ({ children }) => <MemoryRouter initialEntries={[route]}>{children}<LocationProbe /></MemoryRouter> })
}

const loan = (number = 1, extra = {}) => ({
    id: `loan-${number}`, unitKerjaId: 'unit-a', lendingType: 'arsip', status: 'borrowed',
    arsipId: `archive-${number}`, borrowerName: `Peminjam ${number}`, departmentUnit: 'Unit uji',
    borrowDate: '2026-01-01', dueDate: '2099-01-01',
    arsip: { id: `archive-${number}`, nomorBerkas: `BERKAS-${number}`, uraianBerkas: `Uraian arsip ${number}` },
    ...extra,
})
const pageResult = (data, { page = 1, total = 1 } = {}) => ({ success: true, data, pagination: { page, limit: 50, total, totalPages: Math.ceil(total / 50) } })
function tab(name) { fireEvent.mouseDown(screen.getByRole('tab', { name, exact: true }), { button: 0, ctrlKey: false }) }
beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = { role: 'admin_unit', unitKerjaId: 'unit-a' }
    mocks.getAll.mockResolvedValue(pageResult([loan()]))
    mocks.getStats.mockResolvedValue({ success: true, data: { borrowed: 1, overdue: 0, returned: 0, total: 1 } })
    mocks.getUnits.mockResolvedValue([{ id: 'unit-a', name: 'Unit A' }, { id: 'unit-b', name: 'Unit B' }])
    mocks.return.mockResolvedValue({})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('lending server search and pagination', () => {
    it('loads only overdue rows from the dashboard link and ignores a foreign unit for an assigned administrator', async () => {
        render(<ArchiveLending />, '/archive-lending?status=overdue&unitKerjaId=unit-b')
        await screen.findByText('Peminjam 1')
        expect(mocks.getAll.mock.calls.every(([query]) => query.status === 'overdue' && query.unitKerjaId === 'unit-a')).toBe(true)
        expect(screen.getByRole('tab', { name: 'Terlambat', exact: true })).toHaveAttribute('aria-selected', 'true')
        tab('Riwayat')
        await waitFor(() => expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'returned', unitKerjaId: 'unit-a', page: 1 })))
        expect(screen.getByLabelText('Lokasi uji')).toHaveTextContent('status=returned')
    })
    it('preselects a valid linked unit for a super administrator without issuing an unscoped query', async () => {
        mocks.user = { role: 'super_admin' }
        render(<ArchiveLending />, '/archive-lending?status=overdue&unitKerjaId=unit-b')
        await screen.findByText('Peminjam 1')
        expect(mocks.getAll.mock.calls.every(([query]) => query.status === 'overdue' && query.unitKerjaId === 'unit-b')).toBe(true)
        expect(screen.getByRole('combobox', { name: /Unit kerja tujuan/ })).toHaveTextContent('Unit B')
    })
    it.each(['', '&unitKerjaId=unknown'])('requires a valid unit choice for a super administrator (%s)', async unitQuery => {
        mocks.user = { role: 'super_admin' }
        render(<ArchiveLending />, `/archive-lending?status=overdue${unitQuery}`)
        await screen.findByText('Pilih unit kerja sebelum memuat, mengunggah, atau mencetak data.')
        expect(mocks.getAll).not.toHaveBeenCalled()
        expect(mocks.getStats).not.toHaveBeenCalled()
    })
    it('falls back to the existing active tab for an unknown URL status', async () => {
        render(<ArchiveLending />, '/archive-lending?status=not-a-status')
        await screen.findByText('Peminjam 1')
        expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'borrowed', unitKerjaId: 'unit-a' }))
    })
    it('keeps the server borrowed status for a loan due today after local midnight', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date('2026-09-14T05:00:00.000Z'))
        mocks.getAll.mockResolvedValue(pageResult([loan(1, { status: 'borrowed', dueDate: '2026-09-14' })]))
        render(<ArchiveLending />)
        const borrower = await screen.findByText('Peminjam 1')
        const row = within(borrower.closest('tr'))
        expect(row.getByText('Dipinjam', { exact: true })).toBeVisible()
        expect(row.queryByText(/Terlambat/)).not.toBeInTheDocument()
    })

    it('displays real archive numbers/descriptions and box codes/names', async () => {
        mocks.getAll.mockResolvedValue(pageResult([loan(), loan(2, {
            lendingType: 'box', storageLocationId: 'box-1', arsip: null,
            storageLocation: { id: 'box-1', code: 'BOX-A', name: 'Boks arsip sintetis' },
        })], { total: 2 }))
        render(<ArchiveLending />)
        expect(await screen.findByText('BERKAS-1')).toBeVisible()
        expect(screen.getByText('Uraian arsip 1')).toBeVisible()
        expect(screen.getByText('BOX-A')).toBeVisible()
        expect(screen.getByText('Boks arsip sintetis')).toBeVisible()
    })

    it('finds a record outside the first 50 rows through debounced server search', async () => {
        mocks.getAll.mockImplementation(({ search, page = 1 }) => Promise.resolve(search === 'arsip langka'
            ? pageResult([loan(101, { arsip: { id: 'archive-101', nomorBerkas: 'LANGKA-101', uraianBerkas: 'arsip langka' } })])
            : pageResult([loan(page === 1 ? 1 : 51)], { page, total: 101 })))
        render(<ArchiveLending />)
        await screen.findByText('Peminjam 1')
        fireEvent.change(screen.getByPlaceholderText('Cari peminjam, nomor arsip...'), { target: { value: 'arsip langka' } })
        expect(await screen.findByText('LANGKA-101')).toBeVisible()
        expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'arsip langka', unitKerjaId: 'unit-a', page: 1, limit: 50 }))
        expect(screen.queryByText('Peminjam 1')).not.toBeInTheDocument()
        expect(screen.getByText('1 peminjaman · Halaman 1 dari 1')).toBeVisible()
    })

    it('reaches page3 and resets pagination when tabs or search change', async () => {
        mocks.getAll.mockImplementation(({ page = 1, status, search }) => Promise.resolve(pageResult([loan((page - 1) * 50 + 1, {
            borrowerName: `${status}-${search || 'semua'}-${page}`,
        })], { page, total: 101 })))
        render(<ArchiveLending />)
        await screen.findByText('borrowed-semua-1')
        for (const page of [2, 3]) {
            fireEvent.click(screen.getByRole('button', { name: 'Berikutnya', exact: true }))
            await screen.findByText(`borrowed-semua-${page}`)
        }
        expect(screen.getByText('101 peminjaman · Halaman 3 dari 3')).toBeVisible()
        expect(screen.getByRole('button', { name: 'Berikutnya', exact: true })).toBeDisabled()
        tab('Terlambat')
        await screen.findByText('overdue-semua-1')
        expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'overdue', page: 1 }))
        fireEvent.click(screen.getByRole('button', { name: 'Berikutnya', exact: true }))
        await screen.findByText('overdue-semua-2')
        fireEvent.change(screen.getByPlaceholderText('Cari peminjam, nomor arsip...'), { target: { value: '  sasaran  ' } })
        await screen.findByText('overdue-sasaran-1')
        expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'sasaran', page: 1 }))
        tab('Riwayat')
        await screen.findByText('returned-sasaran-1')
    })

    it('shows a load error rather than a false empty list and retries the same query', async () => {
        mocks.getAll.mockRejectedValueOnce(new Error('Daftar sementara tidak tersedia')).mockResolvedValue(pageResult([loan(2)]))
        render(<ArchiveLending />)
        expect(await screen.findByRole('alert')).toHaveTextContent('Daftar sementara tidak tersedia')
        expect(screen.queryByText('Tidak ada data peminjaman')).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi', exact: true }))
        expect(await screen.findByText('Peminjam 2')).toBeVisible()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('ignores an old unit response and resets the new unit to page1', async () => {
        let finishOld
        mocks.getAll.mockImplementation(({ unitKerjaId, page = 1 }) => {
            if (unitKerjaId === 'unit-a' && page === 2) return new Promise(resolve => { finishOld = resolve })
            return Promise.resolve(pageResult([loan(1, { borrowerName: unitKerjaId, unitKerjaId })], { page, total: 60 }))
        })
        const view = render(<ArchiveLending />)
        await screen.findByText('unit-a')
        fireEvent.click(screen.getByRole('button', { name: 'Berikutnya', exact: true }))
        await waitFor(() => expect(finishOld).toBeTypeOf('function'))
        mocks.user = { role: 'admin_unit', unitKerjaId: 'unit-b' }
        view.rerender(<ArchiveLending />)
        expect(await screen.findByText('unit-b')).toBeVisible()
        await act(async () => finishOld(pageResult([loan(51, { borrowerName: 'RESPONS UNIT LAMA' })], { page: 2, total: 60 })))
        expect(screen.queryByText('RESPONS UNIT LAMA')).not.toBeInTheDocument()
        expect(screen.getByText('unit-b')).toBeVisible()
        expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ unitKerjaId: 'unit-b', page: 1 }))
    })

    it('ignores a slow previous search after a newer search has finished', async () => {
        let finishOld
        mocks.getAll.mockImplementation(({ search }) => search === 'lama'
            ? new Promise(resolve => { finishOld = resolve })
            : Promise.resolve(pageResult([loan(1, { borrowerName: search === 'baru' ? 'HASIL BARU' : 'AWAL' })])))
        render(<ArchiveLending />)
        await screen.findByText('AWAL')
        const input = screen.getByPlaceholderText('Cari peminjam, nomor arsip...')
        fireEvent.change(input, { target: { value: 'lama' } })
        await waitFor(() => expect(finishOld).toBeTypeOf('function'))
        fireEvent.change(input, { target: { value: 'baru' } })
        await screen.findByText('HASIL BARU')
        await act(async () => finishOld(pageResult([loan(2, { borrowerName: 'HASIL LAMA' })])))
        expect(screen.queryByText('HASIL LAMA')).not.toBeInTheDocument()
        expect(screen.getByText('HASIL BARU')).toBeVisible()
    })

    it('preserves return and extend controls for an overdue loan and submits the selected unit', async () => {
        mocks.getAll.mockResolvedValue(pageResult([loan(1, { status: 'overdue' })]))
        render(<ArchiveLending />)
        await screen.findByText('Peminjam 1')
        expect(screen.getByRole('button', { name: 'Perpanjang', exact: true })).toBeEnabled()
        fireEvent.click(screen.getByRole('button', { name: 'Kembalikan', exact: true }))
        const dialog = screen.getByRole('dialog', { name: 'Kembalikan Arsip' })
        fireEvent.change(within(dialog).getByLabelText('Catatan Kondisi (opsional)'), { target: { value: 'Fixture kembali baik' } })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Konfirmasi Pengembalian' }))
        await waitFor(() => expect(mocks.return).toHaveBeenCalledWith('loan-1', 'unit-a', 'Fixture kembali baik'))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })
})
