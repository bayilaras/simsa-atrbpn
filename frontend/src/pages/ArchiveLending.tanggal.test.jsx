import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ArchiveLending from './ArchiveLending'

// Jatuh tempo tidak boleh sebelum hari ini (WIB), dan perpanjangan harus melewati
// jatuh tempo saat ini. Juga saringan satu arsip/boks dari kartu di detail arsip.
const mocks = vi.hoisted(() => ({
    lending: { getAll: vi.fn(), getStats: vi.fn(), borrow: vi.fn(), extend: vi.fn(), return: vi.fn() },
    cariArsip: vi.fn(),
    toast: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin_unit', unitKerjaId: 'unit-a' } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/archive-lending.service', () => ({ default: mocks.lending }))
vi.mock('@/services/arsip.service', () => ({ default: { search: mocks.cariArsip } }))
vi.mock('@/services/storage-location.service', () => ({ default: { getAll: vi.fn() } }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: async () => [{ id: 'unit-a', name: 'Unit A' }] } }))

const ARSIP_ID = '550e8400-e29b-41d4-a716-446655440010'
const BOKS_ID = '550e8400-e29b-41d4-a716-446655440020'
const PESAN_LAMPAU = 'Jatuh tempo tidak boleh sebelum hari ini.'
const PESAN_TIDAK_MAJU = 'Jatuh tempo baru harus setelah jatuh tempo saat ini.'
const pinjaman = (extra = {}) => ({
    id: 'loan-1', unitKerjaId: 'unit-a', lendingType: 'arsip', status: 'borrowed', arsipId: ARSIP_ID,
    borrowerName: 'Sari Wulandari', departmentUnit: 'Kanwil', borrowDate: '2026-11-20', dueDate: '2026-12-01',
    arsip: { id: ARSIP_ID, nomorBerkas: 'B-001/2026', uraianBerkas: 'Berkas pengadaan' },
    ...extra,
})
const halaman = (data) => ({ success: true, data, pagination: { page: 1, limit: 50, total: data.length, totalPages: data.length ? 1 : 0 } })

function tampilkan(route = '/archive-lending') {
    return render(<MemoryRouter initialEntries={[route]}><ArchiveLending /></MemoryRouter>)
}

beforeEach(() => {
    vi.clearAllMocks()
    // 25 November 2026 pukul 00.30 WIB; menurut UTC masih 24 November.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-24T17:30:00Z'))
    mocks.lending.getAll.mockResolvedValue(halaman([pinjaman()]))
    mocks.lending.getStats.mockResolvedValue({ success: true, data: { borrowed: 1, overdue: 0, returned: 0, total: 1 } })
    mocks.lending.borrow.mockResolvedValue({ id: 'loan-baru' })
    mocks.lending.extend.mockResolvedValue({ id: 'loan-1' })
    mocks.cariArsip.mockResolvedValue({ success: true, data: [{ id: ARSIP_ID, nomorBerkas: 'B-001/2026', uraianBerkas: 'Berkas pengadaan' }] })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Catat Peminjaman', () => {
    async function isiSampaiTanggal() {
        tampilkan()
        fireEvent.click(await screen.findByRole('button', { name: 'Catat Peminjaman' }))
        const dialog = within(await screen.findByRole('dialog'))
        fireEvent.change(dialog.getByRole('textbox', { name: 'Cari arsip yang akan dipinjam' }), { target: { value: 'B-001' } })
        fireEvent.click(await dialog.findByRole('button', { name: /B-001\/2026/ }))
        fireEvent.change(dialog.getByLabelText('Peminjam'), { target: { value: 'Rudi Hartono' } })
        return dialog
    }

    it('isian Jatuh Tempo dibatasi mulai hari ini (WIB) dan tanggal lampau menampilkan pesan tanpa mengirim', async () => {
        const dialog = await isiSampaiTanggal()
        const tanggal = dialog.getByLabelText('Jatuh Tempo')
        expect(tanggal).toHaveAttribute('min', '2026-11-25')
        expect(dialog.queryByRole('alert')).toBeNull()

        fireEvent.change(tanggal, { target: { value: '2026-11-24' } })
        expect(dialog.getByRole('alert')).toHaveTextContent(PESAN_LAMPAU)
        expect(tanggal).toHaveAttribute('aria-invalid', 'true')
        expect(tanggal).toHaveAccessibleDescription(PESAN_LAMPAU)
        fireEvent.click(dialog.getByRole('button', { name: 'Simpan Peminjaman' }))
        expect(mocks.lending.borrow).not.toHaveBeenCalled()
        expect(mocks.toast).not.toHaveBeenCalled()
    })

    it('jatuh tempo hari ini diterima dan dikirim', async () => {
        const dialog = await isiSampaiTanggal()
        const tanggal = dialog.getByLabelText('Jatuh Tempo')
        fireEvent.change(tanggal, { target: { value: '2026-11-24' } })
        fireEvent.change(tanggal, { target: { value: '2026-11-25' } })
        expect(dialog.queryByRole('alert')).toBeNull()
        expect(tanggal).not.toHaveAttribute('aria-invalid')

        fireEvent.click(dialog.getByRole('button', { name: 'Simpan Peminjaman' }))
        await waitFor(() => expect(mocks.lending.borrow).toHaveBeenCalledWith(expect.objectContaining({
            unitKerjaId: 'unit-a', lendingType: 'arsip', arsipId: ARSIP_ID, borrowerName: 'Rudi Hartono', dueDate: '2026-11-25',
        })))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Berhasil' })))
    })
})

describe('Perpanjang Peminjaman', () => {
    async function bukaPerpanjang() {
        tampilkan()
        await screen.findByText('Sari Wulandari')
        fireEvent.click(screen.getByRole('button', { name: 'Perpanjang' }))
        return within(await screen.findByRole('dialog'))
    }

    it('tanggal harus melewati jatuh tempo saat ini; pesan tampil setelah diubah atau dikirim', async () => {
        const dialog = await bukaPerpanjang()
        const tanggal = dialog.getByLabelText('Tanggal Jatuh Tempo Baru')
        // Jatuh tempo saat ini 1 Desember: paling cepat 2 Desember.
        expect(tanggal).toHaveAttribute('min', '2026-12-02')
        expect(tanggal).toHaveValue('2026-12-01')
        expect(dialog.queryByRole('alert')).toBeNull()

        // Mengirim tanggal yang sama dengan jatuh tempo saat ini.
        fireEvent.click(dialog.getByRole('button', { name: 'Perpanjang' }))
        expect(dialog.getByRole('alert')).toHaveTextContent(PESAN_TIDAK_MAJU)
        expect(mocks.lending.extend).not.toHaveBeenCalled()

        fireEvent.change(tanggal, { target: { value: '2026-11-20' } })
        expect(dialog.getByRole('alert')).toHaveTextContent(PESAN_LAMPAU)
        fireEvent.click(dialog.getByRole('button', { name: 'Perpanjang' }))
        expect(mocks.lending.extend).not.toHaveBeenCalled()

        fireEvent.change(tanggal, { target: { value: '2026-12-10' } })
        expect(dialog.queryByRole('alert')).toBeNull()
        fireEvent.click(dialog.getByRole('button', { name: 'Perpanjang' }))
        await waitFor(() => expect(mocks.lending.extend).toHaveBeenCalledWith('loan-1', 'unit-a', '2026-12-10'))
        expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Berhasil' }))
    })

    it('pinjaman terlambat boleh diperpanjang mulai hari ini, tidak ke tanggal yang sudah lewat', async () => {
        mocks.lending.getAll.mockResolvedValue(halaman([pinjaman({ status: 'overdue', dueDate: '2026-11-10' })]))
        const dialog = await bukaPerpanjang()
        const tanggal = dialog.getByLabelText('Tanggal Jatuh Tempo Baru')
        expect(tanggal).toHaveAttribute('min', '2026-11-25')

        fireEvent.change(tanggal, { target: { value: '2026-11-24' } })
        expect(dialog.getByRole('alert')).toHaveTextContent(PESAN_LAMPAU)
        fireEvent.change(tanggal, { target: { value: '2026-11-25' } })
        expect(dialog.queryByRole('alert')).toBeNull()
        fireEvent.click(dialog.getByRole('button', { name: 'Perpanjang' }))
        await waitFor(() => expect(mocks.lending.extend).toHaveBeenCalledWith('loan-1', 'unit-a', '2026-11-25'))
    })
})

describe('saringan satu arsip atau satu boks dari alamat', () => {
    it('meneruskan arsipId ke server, menyebut arsipnya, dan dapat dihapus', async () => {
        tampilkan(`/archive-lending?status=overdue&arsipId=${ARSIP_ID}`)
        await screen.findByText('Sari Wulandari')
        expect(mocks.lending.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'overdue', arsipId: ARSIP_ID, unitKerjaId: 'unit-a' }))
        expect(screen.getByText(/Hanya menampilkan peminjaman satu arsip: B-001\/2026\./)).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Tampilkan semua' }))
        await waitFor(() => expect(mocks.lending.getAll.mock.lastCall[0]).not.toHaveProperty('arsipId'))
        expect(mocks.lending.getAll.mock.lastCall[0]).toMatchObject({ status: 'overdue', unitKerjaId: 'unit-a' })
        await waitFor(() => expect(screen.queryByText(/Hanya menampilkan peminjaman satu arsip/)).toBeNull())
    })

    it('meneruskan storageLocationId untuk peminjaman boks', async () => {
        mocks.lending.getAll.mockResolvedValue(halaman([pinjaman({
            lendingType: 'box', arsipId: null, arsip: null, storageLocationId: BOKS_ID,
            storageLocation: { id: BOKS_ID, code: 'G1-R1-B07', name: 'Boks Tujuh' },
        })]))
        tampilkan(`/archive-lending?status=borrowed&storageLocationId=${BOKS_ID}`)
        await screen.findByText('Sari Wulandari')
        expect(mocks.lending.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ storageLocationId: BOKS_ID }))
        expect(mocks.lending.getAll.mock.lastCall[0]).not.toHaveProperty('arsipId')
        expect(screen.getByText(/Hanya menampilkan peminjaman satu boks: G1-R1-B07\./)).toBeInTheDocument()
    })

    it('mengabaikan pengenal yang bukan UUID', async () => {
        tampilkan('/archive-lending?arsipId=bukan-uuid&storageLocationId=1%20OR%201')
        await screen.findByText('Sari Wulandari')
        expect(mocks.lending.getAll.mock.calls.every(([query]) => !('arsipId' in query) && !('storageLocationId' in query))).toBe(true)
        expect(screen.queryByRole('button', { name: 'Tampilkan semua' })).toBeNull()
    })
})
