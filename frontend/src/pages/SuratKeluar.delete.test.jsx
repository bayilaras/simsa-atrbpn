import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import SuratKeluar from './SuratKeluar'

// Hapus surat keluar meminta alasan (>=10 karakter) seperti surat masuk; alasan
// itu tampil di daftar Surat Terhapus milik Super Admin.
const mocks = vi.hoisted(() => ({
    keluar: { getAll: vi.fn(), getStats: vi.fn(), delete: vi.fn(), archive: vi.fn() },
    approval: { getPending: vi.fn() },
    toast: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({
    user: { id: 'admin-a', role: 'admin_unit', unitKerjaId: 'unit-a' }, canWrite: () => true,
}) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({
    mode: 'full', capabilities: { metadata: true, files: false, fileUploads: false, externalIntegrations: false },
}) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/surat-keluar.service', () => ({ default: mocks.keluar }))
vi.mock('@/services/approval.service', () => ({ default: mocks.approval }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ImportFromGDrive', () => ({ default: () => null }))
vi.mock('@/components/ImportFileDialog', () => ({ default: () => null }))

beforeEach(() => {
    vi.clearAllMocks()
    mocks.keluar.getAll.mockResolvedValue({
        success: true,
        data: [{ id: 'sk-del-1', nomorSurat: 'SK-DEL/2026', perihal: 'Draf yang dihapus', tanggalSurat: '2026-09-12', approvalStatus: 'draft', createdBy: 'admin-a', isArchived: false }],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    })
    mocks.keluar.getStats.mockResolvedValue({ total: 1, diarsipkan: 0 })
    mocks.keluar.delete.mockResolvedValue(undefined)
    mocks.approval.getPending.mockResolvedValue([])
})
afterEach(cleanup)

async function bukaDialogHapus() {
    render(<MemoryRouter><SuratKeluar /></MemoryRouter>)
    await screen.findByText('SK-DEL/2026')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Buka menu tindakan surat keluar' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Hapus Surat' }))
    await screen.findByRole('alertdialog')
}

it('tombol Hapus nonaktif sampai alasan minimal 10 karakter, lalu alasan dikirim ke layanan', async () => {
    await bukaDialogHapus()
    const tombolHapus = screen.getByRole('button', { name: 'Hapus' })
    expect(tombolHapus).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/^Alasan penghapusan/), { target: { value: 'pendek' } })
    expect(tombolHapus).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/^Alasan penghapusan/), { target: { value: '  Draf ganda, sudah dibuat ulang ' } })
    expect(tombolHapus).toBeEnabled()
    fireEvent.click(tombolHapus)
    await waitFor(() => expect(mocks.keluar.delete).toHaveBeenCalledWith('sk-del-1', { alasan: 'Draf ganda, sudah dibuat ulang' }))
})

it('penolakan server menampilkan pesannya, bukan nama kelas galat', async () => {
    const body = { success: false, error: 'ValidationError', message: 'Alasan minimal 10 karakter', code: 'VALIDATION_ERROR' }
    mocks.keluar.delete.mockRejectedValue(Object.assign(new Error(body.message), { status: 400, data: body, response: { status: 400, data: body } }))
    await bukaDialogHapus()
    fireEvent.change(screen.getByLabelText(/^Alasan penghapusan/), { target: { value: 'Draf ganda, sudah dibuat ulang' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Alasan minimal 10 karakter', variant: 'destructive' })))
})
