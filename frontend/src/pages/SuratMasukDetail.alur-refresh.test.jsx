import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// N1 regresi: setelah fix F1 (fetchSurat menjadi refresh diam agar tidak
// membongkar AlurSuratPanel), panel tidak lagi punya cara untuk memuat ulang
// getBySurat setelah aksi di level halaman -- AlurSuratPanel.jsx:84 hanya
// bergantung pada [jenis, suratId, muatKe], dan tidak ada satupun yang
// berubah saat halaman memanggil setSurat(). Test ini memakai AlurSuratPanel
// ASLI (tidak di-mock) dan memastikan Terima Disposisi memicu getBySurat
// KEDUA KALI lewat sinyal muatUlangKe yang dikendalikan halaman.
const mocks = vi.hoisted(() => ({ getById: vi.fn(), getBySurat: vi.fn(), receive: vi.fn(), toast: vi.fn() }))
vi.mock('@/components/surat/KoreksiBerkasSection', () => ({ default: () => null }))
vi.mock('@/services/surat-masuk.service', () => ({ default: { getById: mocks.getById, archive: vi.fn() } }))
vi.mock('@/services/rangkaian.service', () => ({ default: { getBySurat: mocks.getBySurat } }))
vi.mock('@/services/distribution.service', () => ({ default: { receive: mocks.receive } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ canWrite: () => true, user: { id: 'user-a', role: 'admin_unit', unitKerjaId: 'dir_bppt' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))
vi.mock('@/components/surat-masuk/FilePreviewSection', () => ({ FilePreviewSection: () => null }))

import SuratMasukDetail from './SuratMasukDetail'

const surat = {
    id: 'sm-1', nomorSurat: 'SM-1/2026', perihal: 'Permohonan data', unitKerjaId: 'dir_bppt',
    dari: 'Kanwil A', tanggalSurat: '2026-09-01', status: 'belum_dibalas', sifatSurat: 'biasa', isArchived: false,
    aksesMelalui: 'owner', aksiDiizinkan: ['terima'],
    distribusiUnitSaya: { id: 'd-1', status: 'sent' },
}

const rangkaianData = {
    rangkaian: {
        kode: 'RS-2026-000001', judul: 'Rangkaian Uji', status: 'aktif',
        unitPencatat: { nama: 'Sekretariat Ditjen' }, unitPengolah: null, diberkaskanAt: null,
    },
    peserta: [],
    anggota: [],
    relasi: [],
    disposisi: [{
        id: 'd1', targetUnit: { nama: 'Dit. BPPT' }, status: 'sent', batasWaktu: null,
        penanggungJawab: false, ditutupPengawas: false, instruction: null, catatanPenyelesaian: null,
        rejectionReason: null, penyelesaianAnggotaId: null, masked: false,
    }],
    rangkaianTerkait: [],
    truncated: false,
}

const renderDetail = () => render(
    <MemoryRouter initialEntries={['/surat/masuk/sm-1']}>
        <Routes><Route path="/surat/masuk/:id" element={<SuratMasukDetail />} /></Routes>
    </MemoryRouter>,
)

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

it('Terima Disposisi memuat ulang AlurSuratPanel (getBySurat terpanggil kedua kali), bukan hanya surat halaman', async () => {
    mocks.getById.mockResolvedValue(surat)
    mocks.getBySurat.mockResolvedValue(rangkaianData)
    mocks.receive.mockResolvedValue({})
    renderDetail()
    await screen.findByRole('heading', { name: 'Detail Surat Masuk' })
    await screen.findByText('Alur Surat')
    expect(mocks.getBySurat).toHaveBeenCalledTimes(1)

    const [tombolMenu] = screen.getAllByRole('button', { name: /Tindak Lanjut/ })
    fireEvent.keyDown(tombolMenu, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Terima Disposisi' }))

    await waitFor(() => expect(mocks.receive).toHaveBeenCalledWith('d-1', 'dir_bppt'))
    // Fix N1: setelah Terima sukses, panel harus memuat ulang rangkaian --
    // sebelum fix ini tetap 1 selamanya karena effect deps panel tidak
    // berubah saat halaman me-refresh surat-nya secara diam.
    await waitFor(() => expect(mocks.getBySurat).toHaveBeenCalledTimes(2))
})
