import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Dosir from './Dosir'

const mocks = vi.hoisted(() => ({ canWrite: vi.fn(), toast: vi.fn(), getAll: vi.fn(), getStats: vi.fn(), update: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin-a', role: 'admin_unit', unitKerjaId: 'ditjen' }, canWrite: mocks.canWrite }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: async () => [] } }))
vi.mock('@/services/dosir.service', () => ({ default: { getAll: mocks.getAll, getStats: mocks.getStats, update: mocks.update } }))

const dosir = {
    id: 'd1', kode: 'ditjen-2026-001', judul: 'Perkara sintetis', status: 'open', kategori: 'Sengketa Tanah',
    tanggalMulai: '2026-09-14', tanggalSelesai: null, deskripsi: 'Deskripsi lama',
}

async function bukaEdit() {
    render(<MemoryRouter><Dosir /></MemoryRouter>)
    await screen.findByText(dosir.judul)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Buka menu aksi dosir' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    return screen.findByRole('dialog', { name: 'Edit Dosir' })
}

beforeEach(() => {
    mocks.toast.mockReset()
    mocks.canWrite.mockReset().mockReturnValue(true)
    mocks.getAll.mockReset().mockResolvedValue([dosir])
    mocks.getStats.mockReset().mockResolvedValue({ total: 1, open: 1, closed: 0, archived: 0 })
    mocks.update.mockReset().mockResolvedValue({ ...dosir, judul: 'Perkara revisi' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Edit dari kartu dosir', () => {
    it('membuka dialog berisi data dosir, menyimpan, memberi tahu, lalu memuat ulang daftar', async () => {
        const dialog = await bukaEdit()
        const judul = within(dialog).getByLabelText('Judul Perkara *')
        expect(judul).toHaveValue('Perkara sintetis')
        expect(within(dialog).getByLabelText('Tanggal Mulai')).toHaveValue('2026-09-14')
        expect(within(dialog).getByRole('combobox', { name: 'Kategori' })).toHaveTextContent('Sengketa Tanah')

        fireEvent.change(judul, { target: { value: '  Perkara revisi ' } })
        fireEvent.change(within(dialog).getByLabelText('Deskripsi'), { target: { value: 'Deskripsi baru' } })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan Perubahan' }))

        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
            title: 'Dosir diperbarui', description: 'Perubahan pada dosir ditjen-2026-001 telah disimpan.',
        }))
        expect(mocks.update).toHaveBeenCalledWith('d1', {
            judul: 'Perkara revisi', kategori: 'Sengketa Tanah', tanggalMulai: '2026-09-14', deskripsi: 'Deskripsi baru',
        })
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        await waitFor(() => expect(mocks.getAll).toHaveBeenCalledTimes(2))
    })

    it('menampilkan pesan server bila gagal dan membiarkan isian tetap terbuka', async () => {
        const pesan = 'Dosir tidak ditemukan atau sudah dihapus.'
        mocks.update.mockRejectedValue(Object.assign(new Error(pesan), { status: 404, data: { success: false, error: pesan } }))
        const dialog = await bukaEdit()
        fireEvent.change(within(dialog).getByLabelText('Judul Perkara *'), { target: { value: 'Perkara revisi' } })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan Perubahan' }))

        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
            title: 'Dosir gagal diperbarui', description: pesan, variant: 'destructive',
        }))
        expect(screen.getByRole('dialog', { name: 'Edit Dosir' })).toBeInTheDocument()
        expect(within(dialog).getByLabelText('Judul Perkara *')).toHaveValue('Perkara revisi')
        expect(mocks.getAll).toHaveBeenCalledTimes(1)
    })

    it('tidak menyimpan judul kosong', async () => {
        const dialog = await bukaEdit()
        fireEvent.change(within(dialog).getByLabelText('Judul Perkara *'), { target: { value: '   ' } })
        expect(within(dialog).getByRole('button', { name: 'Simpan Perubahan' })).toBeDisabled()
        expect(mocks.update).not.toHaveBeenCalled()
    })

    it('kategori isian bebas dari halaman detail tetap tampil', async () => {
        mocks.getAll.mockResolvedValue([{ ...dosir, kategori: 'Perkara khusus' }])
        const dialog = await bukaEdit()
        expect(within(dialog).getByRole('combobox', { name: 'Kategori' })).toHaveTextContent('Perkara khusus')
    })
})
