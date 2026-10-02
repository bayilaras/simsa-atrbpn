import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

// F2: handleTerima (Terima -> distributionService.receive -> refetch diam)
// dan handlePenyelesaian (kini dialog di halaman detail, F-I2; semula navigasi, kontrak
// Produces Task 19) sebelumnya tidak punya test yang bisa gagal.
const mocks = vi.hoisted(() => ({ getById: vi.fn(), receive: vi.fn(), toast: vi.fn(), getDistribusi: vi.fn(), kandidat: vi.fn(), process: vi.fn() }))
vi.mock('@/services/surat-masuk.service', () => ({ default: { getById: mocks.getById, archive: vi.fn() } }))
vi.mock('@/services/distribution.service', () => ({ default: { receive: mocks.receive, getById: mocks.getDistribusi, getKandidatPenyelesaian: mocks.kandidat, process: mocks.process } }))
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

// F-I2: Penyelesaian dibuka langsung di detail (tidak lagi bergantung pada
// halaman 1 Kotak Disposisi); disposisi dimuat lewat GET /api/distributions/:id.
it('Penyelesaian membuka dialog di halaman detail dengan disposisi dari GET /distributions/:id', async () => {
    mocks.getById.mockResolvedValue(surat)
    mocks.getDistribusi.mockResolvedValue({ id: 'd-1', status: 'received', masked: false })
    mocks.kandidat.mockResolvedValue([])
    mocks.process.mockResolvedValue({ id: 'd-1', status: 'processed' })
    renderDetail()
    await screen.findByRole('heading', { name: 'Detail Surat Masuk' })
    const [tombolMenu] = screen.getAllByRole('button', { name: /Tindak Lanjut/ })
    fireEvent.keyDown(tombolMenu, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Penyelesaian' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(mocks.getDistribusi).toHaveBeenCalledWith('d-1')
    expect(screen.queryByLabelText('Lokasi distribusi')).toBeNull()
    await waitFor(() => expect(mocks.kandidat).toHaveBeenCalledWith('d-1', 'dir_bppt'))
    fireEvent.click(dialog.getByRole('radio', { name: /Catatan penyelesaian/ }))
    fireEvent.change(dialog.getByLabelText('Isi catatan penyelesaian'), { target: { value: 'Sudah ditindaklanjuti lewat rapat koordinasi' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Simpan Penyelesaian' }))
    await waitFor(() => expect(mocks.process).toHaveBeenCalledWith('d-1', 'dir_bppt', { catatanPenyelesaian: 'Sudah ditindaklanjuti lewat rapat koordinasi' }))
    await waitFor(() => expect(mocks.getById).toHaveBeenCalledTimes(2))
})

it('Penyelesaian atas disposisi yang sudah selesai tidak membuka dialog dan memberi tahu pengguna', async () => {
    mocks.getById.mockResolvedValue(surat)
    mocks.getDistribusi.mockResolvedValue({ id: 'd-1', status: 'processed', masked: false })
    renderDetail()
    await screen.findByRole('heading', { name: 'Detail Surat Masuk' })
    const [tombolMenu] = screen.getAllByRole('button', { name: /Tindak Lanjut/ })
    fireEvent.keyDown(tombolMenu, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Penyelesaian' }))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Disposisi tidak dapat diselesaikan', variant: 'destructive' })))
    expect(screen.queryByRole('dialog')).toBeNull()
})

// Task 25: onTautkan diteruskan ke DetailHeader sehingga item "Tautkan ke Rangkaian"
// tampil (bila server mengizinkan) dan membuka TautkanDialog.
it('Tautkan ke Rangkaian membuka dialog tautan untuk surat masuk', async () => {
    mocks.getById.mockResolvedValue({ ...surat, aksiDiizinkan: ['tautkan'] })
    renderDetail()
    await screen.findByRole('heading', { name: 'Detail Surat Masuk' })
    const [tombolMenu] = screen.getAllByRole('button', { name: /Tindak Lanjut/ })
    fireEvent.keyDown(tombolMenu, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Tautkan ke Rangkaian' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Tautkan ke Rangkaian' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Tautkan' })).toBeDisabled()
})
