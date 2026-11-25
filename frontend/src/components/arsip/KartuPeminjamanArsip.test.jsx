import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { KartuPeminjamanArsip } from './KartuPeminjamanArsip'

const mocks = vi.hoisted(() => ({ user: { id: 'u1', role: 'admin_unit', unitKerjaId: 'unit-a' }, getHistoryByArsip: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/services/archive-lending.service', () => ({ default: { getHistoryByArsip: mocks.getHistoryByArsip } }))

const ARSIP_ID = '550e8400-e29b-41d4-a716-446655440010'
const BOKS_ID = '550e8400-e29b-41d4-a716-446655440020'
const arsip = (extra = {}) => ({ id: ARSIP_ID, unitKerjaId: 'unit-a', lendingStatus: 'available', storageLocationId: null, ...extra })
const pinjaman = (extra = {}) => ({
    id: 'loan-1', lendingType: 'arsip', borrowerName: 'Sari Wulandari', departmentUnit: 'Kanwil BPN Jawa Barat',
    borrowDate: '2026-11-03', dueDate: '2026-11-17', returnDate: null, status: 'borrowed', daysOverdue: 0,
    purpose: null, storageLocation: null, ...extra,
})
const ringkasan = (extra = {}) => ({ readable: true, active: [], history: [], total: 0, limit: 10, ...extra })
const kembali = (nomor) => pinjaman({
    id: `lama-${nomor}`, borrowerName: `Peminjam Lama ${nomor}`, departmentUnit: nomor === 1 ? 'Bagian Umum' : null,
    borrowDate: '2026-01-05', dueDate: '2026-01-12', returnDate: '2026-01-10', status: 'returned',
})

function tampilkan(rekod = arsip()) {
    return render(<MemoryRouter><KartuPeminjamanArsip arsip={rekod} /></MemoryRouter>)
}

beforeEach(() => {
    mocks.user = { id: 'u1', role: 'admin_unit', unitKerjaId: 'unit-a' }
    mocks.getHistoryByArsip.mockReset().mockResolvedValue(ringkasan())
})
afterEach(cleanup)

it('arsip tersedia: menyebut tidak sedang dipinjam dan riwayat masih kosong', async () => {
    tampilkan()
    expect(screen.getByRole('status')).toHaveTextContent('Memuat data peminjaman...')
    expect(await screen.findByText('Tersedia')).toBeInTheDocument()
    expect(mocks.getHistoryByArsip).toHaveBeenCalledWith(ARSIP_ID, 'unit-a')
    expect(screen.getByText('Arsip ini tidak sedang dipinjam.')).toBeInTheDocument()
    expect(screen.getByText('Belum ada peminjaman arsip ini yang sudah dikembalikan.')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
})

it('arsip dipinjam: peminjam, unit, tanggal pinjam, jatuh tempo, dan tautan ke daftar yang disaring', async () => {
    mocks.getHistoryByArsip.mockResolvedValue(ringkasan({ active: [pinjaman()] }))
    tampilkan(arsip({ lendingStatus: 'borrowed' }))

    const berjalan = within(await screen.findByRole('list', { name: 'Peminjaman yang sedang berjalan' }))
    expect(berjalan.getByText('Dipinjam')).toBeInTheDocument()
    expect(berjalan.getByText('Sari Wulandari')).toBeInTheDocument()
    expect(berjalan.getByText('Kanwil BPN Jawa Barat')).toBeInTheDocument()
    expect(berjalan.getByText('3 Nov 2026')).toBeInTheDocument()
    expect(berjalan.getByText('17 Nov 2026')).toBeInTheDocument()
    expect(berjalan.queryByText(/Terlambat/)).toBeNull()
    expect(berjalan.getByRole('link', { name: 'Buka di menu Peminjaman' }))
        .toHaveAttribute('href', `/archive-lending?status=borrowed&arsipId=${ARSIP_ID}&unitKerjaId=unit-a`)
    // Pengenal mentah tidak tampil sebagai teks.
    expect(screen.queryByText(ARSIP_ID)).toBeNull()
})

it('pinjaman terlambat: penanda jumlah hari dan tautan ke tab Terlambat', async () => {
    mocks.getHistoryByArsip.mockResolvedValue(ringkasan({ active: [pinjaman({ status: 'overdue', daysOverdue: 8 })] }))
    tampilkan(arsip({ lendingStatus: 'borrowed' }))

    expect(await screen.findByText('Terlambat 8 hari')).toBeInTheDocument()
    expect(screen.queryByText('Dipinjam')).toBeNull()
    expect(screen.getByRole('link', { name: 'Buka di menu Peminjaman' }))
        .toHaveAttribute('href', `/archive-lending?status=overdue&arsipId=${ARSIP_ID}&unitKerjaId=unit-a`)
})

it('boks dipinjam utuh: menyebut boksnya dan menautkan ke peminjaman boks itu', async () => {
    mocks.getHistoryByArsip.mockResolvedValue(ringkasan({
        active: [pinjaman({
            id: 'loan-box', lendingType: 'box', borrowerName: 'Tim Audit', departmentUnit: 'Inspektorat',
            storageLocation: { id: BOKS_ID, code: 'G1-R1-B07', name: 'Boks Tujuh' },
        })],
    }))
    tampilkan(arsip({ lendingStatus: 'borrowed', storageLocationId: BOKS_ID }))

    expect(await screen.findByText('Per boks')).toBeInTheDocument()
    expect(screen.getByText('Boks tempat arsip ini disimpan (G1-R1-B07 — Boks Tujuh) sedang dipinjam seluruhnya.')).toBeInTheDocument()
    expect(screen.getByText('Tim Audit')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Buka peminjaman boks ini' }))
        .toHaveAttribute('href', `/archive-lending?status=borrowed&storageLocationId=${BOKS_ID}&unitKerjaId=unit-a`)
})

it('riwayat: terbaru lebih dulu, dibatasi, dan menyebut jumlah seluruhnya', async () => {
    mocks.getHistoryByArsip.mockResolvedValue(ringkasan({ history: [kembali(2), kembali(1)], total: 14 }))
    tampilkan()

    expect(await screen.findByText('Peminjam Lama 2')).toBeInTheDocument()
    expect(screen.getByText('Bagian Umum')).toBeInTheDocument()
    expect(screen.getAllByText('Dipinjam 5 Jan 2026, kembali 10 Jan 2026')).toHaveLength(2)
    expect(screen.getByText('Menampilkan 2 peminjaman terakhir dari 14.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lihat riwayat di menu Peminjaman' }))
        .toHaveAttribute('href', `/archive-lending?status=returned&arsipId=${ARSIP_ID}&unitKerjaId=unit-a`)
})

it('riwayat yang muat seluruhnya menyebut jumlahnya tanpa kata "terakhir"', async () => {
    mocks.getHistoryByArsip.mockResolvedValue(ringkasan({ history: [kembali(1)], total: 1 }))
    tampilkan()
    expect(await screen.findByText('1 peminjaman sudah dikembalikan.')).toBeInTheDocument()
})

it('staf melihat peminjam tetapi tidak mendapat tautan ke menu Peminjaman', async () => {
    mocks.user = { id: 'u2', role: 'staff', unitKerjaId: 'unit-a' }
    mocks.getHistoryByArsip.mockResolvedValue(ringkasan({ active: [pinjaman()], history: [kembali(1)], total: 1 }))
    tampilkan(arsip({ lendingStatus: 'borrowed' }))

    expect(await screen.findByText('Sari Wulandari')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
})

it.each([
    ['jawaban readable: false', () => mocks.getHistoryByArsip.mockResolvedValue({ readable: false, active: [], history: [], total: 0, limit: 10 })],
    ['penolakan 403', () => mocks.getHistoryByArsip.mockRejectedValue(Object.assign(new Error('Akses ditolak'), { status: 403 }))],
    ['jawaban 404', () => mocks.getHistoryByArsip.mockRejectedValue(Object.assign(new Error('Tidak ditemukan'), { status: 404 }))],
])('tanpa hak melihat peminjaman (%s): kartu hanya menyebut statusnya, tanpa galat', async (_label, siapkan) => {
    siapkan()
    tampilkan(arsip({ lendingStatus: 'borrowed' }))

    expect(await screen.findByText('Arsip ini tercatat sedang dipinjam. Rincian peminjam tidak ditampilkan untuk akun Anda.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText('Riwayat peminjaman')).toBeNull()
})

it('tanpa hak melihat peminjaman dan arsip tidak dipinjam: satu kalimat netral', async () => {
    mocks.getHistoryByArsip.mockResolvedValue({ readable: false, active: [], history: [], total: 0, limit: 10 })
    tampilkan()
    expect(await screen.findByText('Rincian peminjaman arsip ini tidak ditampilkan untuk akun Anda.')).toBeInTheDocument()
})

it('gagal memuat: pesan tenang dengan tombol Coba lagi yang memuat ulang', async () => {
    mocks.getHistoryByArsip.mockRejectedValueOnce(Object.assign(new Error('Terjadi kesalahan pada server.'), { status: 500 }))
    tampilkan()

    expect(await screen.findByText('Data peminjaman belum dapat dimuat.')).toBeInTheDocument()
    expect(screen.queryByText('Terjadi kesalahan pada server.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
    expect(await screen.findByText('Tersedia')).toBeInTheDocument()
    expect(mocks.getHistoryByArsip).toHaveBeenCalledTimes(2)
})

it('status arsip dipinjam tanpa catatan pinjaman yang terbaca: mengarahkan ke menu Peminjaman', async () => {
    tampilkan(arsip({ lendingStatus: 'borrowed' }))
    expect(await screen.findByText(/tercatat sedang dipinjam, tetapi catatan peminjamannya tidak ditemukan\. Periksa menu Peminjaman\./)).toBeInTheDocument()
    expect(screen.queryByText('Tersedia')).toBeNull()
})

it('memuat ulang ketika status pinjam atau lokasi simpan arsip berubah', async () => {
    const { rerender } = tampilkan()
    await screen.findByText('Tersedia')
    mocks.getHistoryByArsip.mockResolvedValue(ringkasan({ active: [pinjaman()] }))
    rerender(<MemoryRouter><KartuPeminjamanArsip arsip={arsip({ lendingStatus: 'borrowed' })} /></MemoryRouter>)
    expect(await screen.findByText('Sari Wulandari')).toBeInTheDocument()
    rerender(<MemoryRouter><KartuPeminjamanArsip arsip={arsip({ lendingStatus: 'borrowed', storageLocationId: BOKS_ID })} /></MemoryRouter>)
    await waitFor(() => expect(mocks.getHistoryByArsip).toHaveBeenCalledTimes(3))
})

it('tidak tampil dan tidak meminta data sebelum arsip dan unitnya diketahui', () => {
    const { container } = tampilkan({ id: ARSIP_ID, unitKerjaId: '' })
    expect(container).toBeEmptyDOMElement()
    expect(mocks.getHistoryByArsip).not.toHaveBeenCalled()
})
