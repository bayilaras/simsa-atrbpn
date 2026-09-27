import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

// F2: handleTerima (Terima -> distributionService.receive -> refetch diam)
// dan handlePenyelesaian (navigasi ke /distribusi?penyelesaian=<id>, kontrak
// Produces Task 19) sebelumnya tidak punya test yang bisa gagal.
const mocks = vi.hoisted(() => ({ getById: vi.fn(), receive: vi.fn(), toast: vi.fn() }))
vi.mock('@/services/surat-masuk.service', () => ({ default: { getById: mocks.getById, archive: vi.fn() } }))
vi.mock('@/services/distribution.service', () => ({ default: { receive: mocks.receive } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ canWrite: () => true, user: { id: 'user-a', role: 'admin_unit', unitKerjaId: 'dir_bppt' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))
vi.mock('@/components/surat-masuk/FilePreviewSection', () => ({ FilePreviewSection: () => null }))
vi.mock('@/components/surat/AlurSuratPanel', () => ({ AlurSuratPanel: () => null }))

import SuratMasukDetail from './SuratMasukDetail'

const surat = {
    id: 'sm-1', nomorSurat: 'SM-1/2026', perihal: 'Permohonan data', unitKerjaId: 'dir_bppt',
    dari: 'Kanwil A', tanggalSurat: '2026-09-01', status: 'belum_dibalas', sifatSurat: 'biasa', isArchived: false,
    aksesMelalui: 'owner', aksiDiizinkan: ['terima', 'penyelesaian'],
    distribusiUnitSaya: { id: 'd-1', status: 'sent' },
}

function LokasiDistribusi() {
    const location = useLocation()
    return <output aria-label="Lokasi distribusi">{location.pathname + location.search}</output>
}

const renderDetail = () => render(
    <MemoryRouter initialEntries={['/surat/masuk/sm-1']}>
        <Routes>
            <Route path="/surat/masuk/:id" element={<SuratMasukDetail />} />
            <Route path="/distribusi" element={<LokasiDistribusi />} />
        </Routes>
    </MemoryRouter>,
)

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

it('Terima Disposisi memanggil distributionService.receive lalu memuat ulang surat secara diam', async () => {
    mocks.getById.mockResolvedValue(surat)
    mocks.receive.mockResolvedValue({})
    renderDetail()
    await screen.findByRole('heading', { name: 'Detail Surat Masuk' })
    const [tombolMenu] = screen.getAllByRole('button', { name: /Tindak Lanjut/ })
    fireEvent.keyDown(tombolMenu, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Terima Disposisi' }))
    await waitFor(() => expect(mocks.receive).toHaveBeenCalledWith('d-1', 'dir_bppt'))
    // Refresh setelah Terima harus diam (F1): gerbang loading halaman tidak
    // boleh membongkar tampilan lagi.
    expect(screen.queryByText('Memuat data surat...')).toBeNull()
    await waitFor(() => expect(mocks.getById).toHaveBeenCalledTimes(2))
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Berhasil' }))
})

it('Penyelesaian menavigasi ke /distribusi?penyelesaian=<distribusiId> (kontrak Produces T19)', async () => {
    mocks.getById.mockResolvedValue(surat)
    renderDetail()
    await screen.findByRole('heading', { name: 'Detail Surat Masuk' })
    const [tombolMenu] = screen.getAllByRole('button', { name: /Tindak Lanjut/ })
    fireEvent.keyDown(tombolMenu, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Penyelesaian' }))
    expect(await screen.findByLabelText('Lokasi distribusi')).toHaveTextContent('/distribusi?penyelesaian=d-1')
})
