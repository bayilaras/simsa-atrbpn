import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import SuratMasuk from './SuratMasuk'

// "Disposisi Ke" menawarkan unit tujuan disposisi dengan nama yang sama seperti di
// dialog disposisi, ditambah label Kabag; unit disaring lewat id-nya di server.
const mocks = vi.hoisted(() => ({ getAll: vi.fn(), getStats: vi.fn(), units: vi.fn(), toast: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({
    user: { id: 'admin-ses', role: 'admin_unit', unitKerjaId: 'sesditjen' }, canWrite: () => true,
}) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({
    mode: 'full', capabilities: { metadata: true, files: false, fileUploads: false, externalIntegrations: false },
}) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/surat-masuk.service', () => ({ default: { getAll: mocks.getAll, getStats: mocks.getStats } }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: mocks.units } }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ImportFromGDrive', () => ({ default: () => null }))
vi.mock('@/components/ImportFileDialog', () => ({ default: () => null }))

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAll.mockResolvedValue({
        success: true,
        data: [{ id: 'sm-1', nomorSurat: 'SM-1/2026', perihal: 'Permohonan data', dari: 'Kanwil', tanggalSurat: '2026-09-12', status: 'belum_dibalas', isArchived: false }],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    })
    mocks.getStats.mockResolvedValue({ total: 1, belumDibalas: 1, sudahDibalas: 0, diarsipkan: 0 })
    mocks.units.mockResolvedValue([
        { id: 'sesditjen', name: 'Sekretariat Direktorat Jenderal', unitType: 'sesditjen' },
        { id: 'dir_bppt', name: 'Direktorat BPPT', unitType: 'direktorat' },
        { id: 'bagian_umum', name: 'Bagian Umum', unitType: 'bagian' },
    ])
})
afterEach(cleanup)

async function bukaPilihanDisposisi() {
    render(<MemoryRouter><SuratMasuk /></MemoryRouter>)
    await screen.findByText('SM-1/2026')
    expect(mocks.units).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    await waitFor(() => expect(mocks.units).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('combobox', { name: 'Disposisi Ke' }))
    return screen.findByRole('option', { name: 'Direktorat BPPT' })
}

it('menawarkan unit tujuan dan label Kabag, tanpa unit bagian, unit sendiri, atau label singkat lama', async () => {
    await bukaPilihanDisposisi()
    expect(screen.getByRole('option', { name: 'Kabag Program dan Hukum' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Kabag Kepegawaian Keuangan dan Umum' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Bagian Umum' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Sekretariat Direktorat Jenderal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Dit. BPPT' })).not.toBeInTheDocument()
})

it('memilih unit menyaring lewat id unit tujuan', async () => {
    fireEvent.click(await bukaPilihanDisposisi())
    await waitFor(() => expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ disposisiUnitId: 'dir_bppt', page: 1 })))
    expect(mocks.getAll.mock.lastCall[0]).not.toHaveProperty('disposisi')
})

it('memilih label Kabag menyaring lewat label disposisi', async () => {
    await bukaPilihanDisposisi()
    fireEvent.click(screen.getByRole('option', { name: 'Kabag Program dan Hukum' }))
    await waitFor(() => expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ disposisi: 'Kabag Program dan Hukum' })))
    expect(mocks.getAll.mock.lastCall[0]).not.toHaveProperty('disposisiUnitId')
})
