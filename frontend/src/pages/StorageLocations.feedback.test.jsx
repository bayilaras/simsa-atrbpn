import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import StorageLocations from './StorageLocations'

const mocks = vi.hoisted(() => ({ getTree: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), toast: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin_unit', unitKerjaId: 'ditjen' } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/storage-location.service', () => ({ default: mocks }))

// Bentuk galat services/api.js untuk AppError backend: `error` = nama kelas, `message` = pesan domain.
const galatApi = (status, body) => Object.assign(new Error(body.message), { status, data: body, response: { status, data: body } })
const location = { id: 'location-a', code: 'G1', name: 'Gedung sintetis', level: 'gedung', children: [] }

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getTree.mockResolvedValue({ success: true, data: [location] })
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('tanggapan simpan lokasi', () => {
    it('simpan yang ditolak server menampilkan pesannya, bukan nama kelas galat', async () => {
        mocks.update.mockRejectedValue(galatApi(409, { success: false, error: 'ConflictError', message: 'Kode lokasi sudah digunakan dalam unit kerja ini.', code: 'CONFLICT' }))
        render(<MemoryRouter><StorageLocations /></MemoryRouter>)
        await screen.findByText(location.name)
        fireEvent.click(screen.getByTitle('Edit'))
        fireEvent.click(await screen.findByRole('button', { name: 'Simpan Perubahan' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
            variant: 'destructive', title: 'Gagal menyimpan data', description: 'Kode lokasi sudah digunakan dalam unit kerja ini.',
        }))
    })
})

describe('muat daftar lokasi', () => {
    it('muat yang gagal menampilkan galat dengan Coba lagi, bukan "belum ada data"', async () => {
        mocks.getTree.mockRejectedValueOnce(galatApi(500, { success: false, message: 'Terjadi kesalahan pada server.' }))
        render(<MemoryRouter><StorageLocations /></MemoryRouter>)
        const galat = await screen.findByRole('alert')
        expect(galat).toHaveTextContent('Gagal memuat lokasi penyimpanan')
        expect(screen.queryByText('Belum ada data lokasi penyimpanan')).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
        expect(await screen.findByText(location.name)).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(mocks.getTree).toHaveBeenCalledTimes(2)
    })

    it('daftar yang memang kosong tetap tampil sebagai belum ada data', async () => {
        mocks.getTree.mockResolvedValue({ success: true, data: [] })
        render(<MemoryRouter><StorageLocations /></MemoryRouter>)
        expect(await screen.findByText('Belum ada data lokasi penyimpanan')).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
})

describe('tambah lokasi', () => {
    it('lokasi tanpa induk hanya dapat dibuat sebagai gedung', async () => {
        mocks.create.mockResolvedValue({ id: 'baru' })
        render(<MemoryRouter><StorageLocations /></MemoryRouter>)
        await screen.findByText(location.name)
        fireEvent.click(screen.getByRole('button', { name: 'Tambah Lokasi' }))
        expect(await screen.findByText(/Lokasi paling atas selalu gedung/)).toBeInTheDocument()
        expect(screen.getByRole('combobox', { name: 'Level' })).toBeDisabled()
        expect(screen.getByRole('combobox', { name: 'Level' })).toHaveTextContent('Gedung')

        fireEvent.change(screen.getByLabelText('Kode'), { target: { value: 'G2' } })
        fireEvent.change(screen.getByLabelText('Nama'), { target: { value: 'Gedung kedua' } })
        fireEvent.click(screen.getByRole('button', { name: 'Tambah' }))
        await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
            code: 'G2', name: 'Gedung kedua', level: 'gedung', parentId: null, unitKerjaId: 'ditjen',
        })))
    })

    it('sub-lokasi mengikuti level di bawah induknya tanpa keterangan gedung', async () => {
        render(<MemoryRouter><StorageLocations /></MemoryRouter>)
        await screen.findByText(location.name)
        fireEvent.click(screen.getByTitle('Tambah Sub-lokasi'))
        expect(await screen.findByRole('heading', { name: 'Tambah Ruang' })).toBeInTheDocument()
        expect(screen.getByRole('combobox', { name: 'Level' })).toHaveTextContent('Ruang')
        expect(screen.queryByText(/Lokasi paling atas selalu gedung/)).not.toBeInTheDocument()
    })

    it('tombol simpan terkunci selama menyimpan sehingga klik ganda hanya mengirim sekali', async () => {
        let selesai
        mocks.create.mockReturnValue(new Promise(resolve => { selesai = resolve }))
        render(<MemoryRouter><StorageLocations /></MemoryRouter>)
        await screen.findByText(location.name)
        fireEvent.click(screen.getByRole('button', { name: 'Tambah Lokasi' }))
        fireEvent.change(await screen.findByLabelText('Kode'), { target: { value: 'G2' } })
        fireEvent.change(screen.getByLabelText('Nama'), { target: { value: 'Gedung kedua' } })
        const simpan = screen.getByRole('button', { name: 'Tambah' })
        fireEvent.click(simpan)
        fireEvent.click(simpan)
        expect(await screen.findByRole('button', { name: 'Menyimpan…' })).toBeDisabled()
        expect(mocks.create).toHaveBeenCalledTimes(1)
        selesai({ id: 'baru' })
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: 'Lokasi berhasil ditambahkan' }))
    })
})

describe('tanggapan hapus lokasi', () => {
    // Konfirmasi memakai dialog aplikasi; window.confirm tidak boleh dipanggil.
    beforeEach(() => { vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('window.confirm tidak boleh dipakai') }) })
    const setujuiHapus = async () => {
        fireEvent.click(screen.getByTitle('Hapus'))
        const dialog = await screen.findByRole('alertdialog')
        expect(dialog).toHaveTextContent('Hapus lokasi penyimpanan?')
        expect(dialog).toHaveTextContent('G1 - Gedung sintetis')
        return dialog
    }

    it('hapus yang ditolak server menampilkan alasannya', async () => {
        const message = 'Lokasi tidak dapat dihapus karena masih menyimpan arsip. Pindahkan arsipnya terlebih dahulu.'
        mocks.delete.mockRejectedValue(galatApi(409, { success: false, error: 'ConflictError', message, code: 'CONFLICT' }))
        render(<MemoryRouter><StorageLocations /></MemoryRouter>)
        await screen.findByText(location.name)
        fireEvent.click(within(await setujuiHapus()).getByRole('button', { name: 'Hapus' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
            variant: 'destructive', title: 'Gagal menghapus lokasi', description: message,
        }))
        expect(mocks.delete).toHaveBeenCalledWith('location-a', 'ditjen')
        expect(screen.getByText(location.name)).toBeInTheDocument()
    })

    it('hapus yang berhasil memberi tahu pengguna dan memuat ulang pohon lokasi', async () => {
        mocks.delete.mockResolvedValue({ success: true })
        render(<MemoryRouter><StorageLocations /></MemoryRouter>)
        await screen.findByText(location.name)
        mocks.getTree.mockResolvedValue({ success: true, data: [] })
        fireEvent.click(within(await setujuiHapus()).getByRole('button', { name: 'Hapus' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: 'Lokasi berhasil dihapus' }))
        await waitFor(() => expect(screen.queryByText(location.name)).not.toBeInTheDocument())
        expect(mocks.getTree).toHaveBeenCalledTimes(2)
    })

    it('hapus yang dibatalkan tidak memanggil server', async () => {
        render(<MemoryRouter><StorageLocations /></MemoryRouter>)
        await screen.findByText(location.name)
        fireEvent.click(within(await setujuiHapus()).getByRole('button', { name: 'Batal' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
        expect(mocks.delete).not.toHaveBeenCalled()
        expect(mocks.toast).not.toHaveBeenCalled()
    })
})
