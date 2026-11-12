import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StorageLocations from './StorageLocations'

const mocks = vi.hoisted(() => ({ getTree: vi.fn(), update: vi.fn(), delete: vi.fn(), toast: vi.fn() }))
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
        render(<StorageLocations />)
        await screen.findByText(location.name)
        fireEvent.click(screen.getByTitle('Edit'))
        fireEvent.click(await screen.findByRole('button', { name: 'Simpan Perubahan' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
            variant: 'destructive', title: 'Gagal menyimpan data', description: 'Kode lokasi sudah digunakan dalam unit kerja ini.',
        }))
    })
})

describe('tanggapan hapus lokasi', () => {
    beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true) })

    it('hapus yang ditolak server menampilkan alasannya', async () => {
        const message = 'Lokasi tidak dapat dihapus karena masih menyimpan arsip. Pindahkan arsipnya terlebih dahulu.'
        mocks.delete.mockRejectedValue(galatApi(409, { success: false, error: 'ConflictError', message, code: 'CONFLICT' }))
        render(<StorageLocations />)
        await screen.findByText(location.name)
        fireEvent.click(screen.getByTitle('Hapus'))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
            variant: 'destructive', title: 'Gagal menghapus lokasi', description: message,
        }))
        expect(mocks.delete).toHaveBeenCalledWith('location-a', 'ditjen')
        expect(screen.getByText(location.name)).toBeInTheDocument()
    })

    it('hapus yang berhasil memberi tahu pengguna dan memuat ulang pohon lokasi', async () => {
        mocks.delete.mockResolvedValue({ success: true })
        render(<StorageLocations />)
        await screen.findByText(location.name)
        mocks.getTree.mockResolvedValue({ success: true, data: [] })
        fireEvent.click(screen.getByTitle('Hapus'))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: 'Lokasi berhasil dihapus' }))
        await waitFor(() => expect(screen.queryByText(location.name)).not.toBeInTheDocument())
        expect(mocks.getTree).toHaveBeenCalledTimes(2)
    })

    it('hapus yang dibatalkan tidak memanggil server', async () => {
        window.confirm.mockReturnValue(false)
        render(<StorageLocations />)
        await screen.findByText(location.name)
        fireEvent.click(screen.getByTitle('Hapus'))
        expect(mocks.delete).not.toHaveBeenCalled()
        expect(mocks.toast).not.toHaveBeenCalled()
    })
})
