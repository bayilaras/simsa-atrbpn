import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import SuratMasuk from './SuratMasuk'

// T24-3 (amandemen pra-eksekusi, backs T13): penghapusan surat masuk wajib menyertakan
// "Alasan penghapusan" (>=10 karakter), diteruskan sebagai suratMasukService.delete(id, { alasan }).
const mocks = vi.hoisted(() => ({ getAll: vi.fn(), getStats: vi.fn(), del: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({
    user: { id: 'admin-a', role: 'admin_unit', unitKerjaId: 'unit-a' }, canWrite: () => true,
}) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({
    mode: 'full', capabilities: { metadata: true, files: false, fileUploads: false, externalIntegrations: false },
}) }))
vi.mock('@/services/surat-masuk.service', () => ({ default: { getAll: mocks.getAll, getStats: mocks.getStats, delete: mocks.del } }))
vi.mock('@/services/approval.service', () => ({ default: { getPending: async () => [] }, approvalService: { getPending: async () => [] } }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ImportFromGDrive', () => ({ default: () => null }))
vi.mock('@/components/ImportCsvDialog', () => ({ default: () => null }))

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAll.mockResolvedValue({
        success: true,
        data: [{ id: 'sm-del-1', nomorSurat: 'DEL-1/2026', perihal: 'Surat untuk dihapus', tanggalSurat: '2026-09-12', status: 'belum_dibalas', isArchived: false }],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    })
    mocks.getStats.mockResolvedValue({ total: 1, belumDibalas: 1, sudahDibalas: 0, diarsipkan: 0 })
    mocks.del.mockResolvedValue(undefined)
})
afterEach(cleanup)

async function bukaDialogHapus() {
    render(<MemoryRouter><SuratMasuk /></MemoryRouter>)
    await screen.findByText('DEL-1/2026')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Buka menu tindakan surat masuk' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Hapus Surat' }))
    await screen.findByRole('alertdialog')
}

it('tombol Hapus tetap nonaktif sampai alasan penghapusan diisi minimal 10 karakter', async () => {
    await bukaDialogHapus()
    const tombolHapus = screen.getByRole('button', { name: 'Hapus' })
    expect(tombolHapus).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/^Alasan penghapusan/), { target: { value: 'terlalu pendek' } })
    expect(tombolHapus).toBeEnabled()
    fireEvent.change(screen.getByLabelText(/^Alasan penghapusan/), { target: { value: 'pendek' } })
    expect(tombolHapus).toBeDisabled()
})

it('mengirim alasan penghapusan ke suratMasukService.delete', async () => {
    await bukaDialogHapus()
    fireEvent.change(screen.getByLabelText(/^Alasan penghapusan/), { target: { value: 'Surat ganda, sudah dicatat ulang' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }))
    await waitFor(() => expect(mocks.del).toHaveBeenCalledWith('sm-del-1', { alasan: 'Surat ganda, sudah dicatat ulang' }))
})
