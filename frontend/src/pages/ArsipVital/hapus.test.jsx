import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ArsipVital from './index'

const mocks = vi.hoisted(() => ({
    findAll: vi.fn(), getStats: vi.fn(), getDueForReview: vi.fn(), delete: vi.fn(), toast: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin_unit', unitKerjaId: 'ditjen' } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/arsip-vital.service', () => ({ arsipVitalService: mocks }))
vi.mock('./ArsipVitalTable', () => ({
    default: ({ data, onDelete }) => data.map(item => (
        <button key={item.id} onClick={() => onDelete(item.id)}>Hapus {item.nomorBerkas}</button>
    )),
}))
vi.mock('./ArsipVitalForm', () => ({ default: () => null }))
vi.mock('./ArsipVitalDetail', () => ({ default: () => null }))

const penetapan = { id: 'av-1', nomorBerkas: 'AV-001', arsipId: '11111111-1111-4111-8111-111111111111' }

beforeEach(() => {
    vi.clearAllMocks()
    mocks.findAll.mockResolvedValue({ success: true, data: [penetapan], total: 1, page: 1, totalPages: 1 })
    mocks.getStats.mockResolvedValue({ success: true, data: { total: 1, byStatus: [] } })
    mocks.getDueForReview.mockResolvedValue([])
    // Konfirmasi memakai dialog aplikasi; window.confirm tidak boleh dipanggil.
    vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('window.confirm tidak boleh dipakai') })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const mintaHapus = async () => {
    render(<ArsipVital />)
    fireEvent.click(await screen.findByRole('button', { name: 'Hapus AV-001' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Hapus penetapan arsip vital?' })
    expect(dialog).toHaveTextContent('Penetapan arsip vital ini akan dihapus. Arsipnya sendiri tetap tersimpan.')
    return within(dialog)
}

describe('hapus penetapan arsip vital', () => {
    it('menghapus hanya setelah tombol Hapus di dialog aplikasi dipilih', async () => {
        mocks.delete.mockResolvedValue({ success: true })
        const dialog = await mintaHapus()
        expect(mocks.delete).not.toHaveBeenCalled()
        fireEvent.click(dialog.getByRole('button', { name: 'Hapus' }))
        await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith('av-1'))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: 'Berhasil', description: 'Penetapan dihapus' }))
        await waitFor(() => expect(mocks.findAll).toHaveBeenCalledTimes(2))
    })

    it('Batal tidak menghapus apa pun', async () => {
        const dialog = await mintaHapus()
        fireEvent.click(dialog.getByRole('button', { name: 'Batal' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
        expect(mocks.delete).not.toHaveBeenCalled()
        expect(mocks.toast).not.toHaveBeenCalled()
    })

    it('penolakan server ditampilkan lewat pemberitahuan aplikasi', async () => {
        mocks.delete.mockRejectedValue(new Error('Arsip vital tidak ditemukan.'))
        const dialog = await mintaHapus()
        fireEvent.click(dialog.getByRole('button', { name: 'Hapus' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: 'Gagal', description: 'Arsip vital tidak ditemukan.', variant: 'destructive' }))
    })
})
