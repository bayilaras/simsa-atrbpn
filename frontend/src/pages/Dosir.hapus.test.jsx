import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Dosir from './Dosir'

const mocks = vi.hoisted(() => ({ canWrite: vi.fn(), toast: vi.fn(), getAll: vi.fn(), getStats: vi.fn(), remove: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin-a', role: 'admin_unit', unitKerjaId: 'ditjen' }, canWrite: mocks.canWrite }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: async () => [] } }))
vi.mock('@/services/dosir.service', () => ({ default: { getAll: mocks.getAll, getStats: mocks.getStats, delete: mocks.remove } }))

const dosir = { id: 'd1', unitKerjaId: 'ditjen', kode: 'ditjen-2026-001', judul: 'Perkara sintetis', status: 'open', suratMasukCount: 2, suratKeluarCount: 1 }

async function hapusDosir() {
    render(<MemoryRouter><Dosir /></MemoryRouter>)
    await screen.findByText('Perkara sintetis')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Buka menu aksi dosir' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Hapus' }))
}

beforeEach(() => {
    mocks.toast.mockReset()
    mocks.canWrite.mockReset().mockReturnValue(true)
    mocks.getAll.mockReset().mockResolvedValue([dosir])
    mocks.getStats.mockReset().mockResolvedValue({ total: 1, open: 1, closed: 0, archived: 0 })
    mocks.remove.mockReset().mockResolvedValue({ success: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('hapus dosir', () => {
    it('tidak menawarkan Edit dan Hapus bila pengguna tidak berhak menulis di unit dosir', async () => {
        mocks.canWrite.mockReturnValue(false)
        render(<MemoryRouter><Dosir /></MemoryRouter>)
        await screen.findByText('Perkara sintetis')
        fireEvent.keyDown(screen.getByRole('button', { name: 'Buka menu aksi dosir' }), { key: 'Enter' })
        expect(await screen.findByRole('menuitem', { name: 'Lihat Detail' })).toBeInTheDocument()
        expect(mocks.canWrite).toHaveBeenCalledWith('ditjen')
        expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument()
        expect(screen.queryByRole('menuitem', { name: 'Hapus' })).not.toBeInTheDocument()
    })

    it('memberi tahu bila dosir berhasil dihapus lalu memuat ulang daftar', async () => {
        await hapusDosir()
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
            title: 'Dosir dihapus',
            description: 'Dosir ditjen-2026-001 telah dihapus. Surat yang pernah ditautkan tetap tersimpan.',
        }))
        expect(mocks.remove).toHaveBeenCalledWith('d1')
        await waitFor(() => expect(mocks.getAll).toHaveBeenCalledTimes(2))
    })

    it('menampilkan pesan server bila dosir gagal dihapus', async () => {
        const pesan = 'Dosir tidak ditemukan atau sudah dihapus.'
        mocks.remove.mockRejectedValue(Object.assign(new Error(pesan), { status: 404, data: { success: false, error: pesan } }))
        await hapusDosir()
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
            title: 'Dosir gagal dihapus', description: pesan, variant: 'destructive',
        }))
        expect(mocks.getAll).toHaveBeenCalledTimes(1)
    })

    it('memakai pesan Indonesia dari server saat batas operasi tercapai', async () => {
        mocks.remove.mockRejectedValue(Object.assign(new Error('Terlalu banyak permintaan. Coba lagi nanti.'), {
            status: 429,
            data: { error: 'Too Many Requests', message: 'Terlalu banyak operasi sensitif. Coba lagi setelah 15 menit.' },
        }))
        await hapusDosir()
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Dosir gagal dihapus', description: 'Terlalu banyak operasi sensitif. Coba lagi setelah 15 menit.',
        })))
    })
})
