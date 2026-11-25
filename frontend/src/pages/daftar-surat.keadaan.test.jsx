import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import SuratMasuk from './SuratMasuk'
import SuratKeluar from './SuratKeluar'
import { kunciKeadaanDaftar, tulisKeadaanDaftar } from '@/lib/keadaan-daftar'

// Filter, pencarian, dan halaman daftar surat bertahan saat pengguna kembali
// dari halaman detail, tetapi mulai dari awal bila daftar dibuka dari menu.
const mocks = vi.hoisted(() => ({
    masuk: { getAll: vi.fn(), getStats: vi.fn(), delete: vi.fn() },
    keluar: { getAll: vi.fn(), getStats: vi.fn(), delete: vi.fn(), archive: vi.fn() },
    user: { id: 'admin-a', role: 'admin_unit', unitKerjaId: 'unit-a' },
    // Harus rujukan yang tetap: daftar memuat ulang bila fungsi toast berganti.
    toast: vi.fn(),
}))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, canWrite: () => true }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({
    mode: 'full', capabilities: { metadata: true, files: false, fileUploads: false, externalIntegrations: false },
}) }))
vi.mock('@/services/surat-masuk.service', () => ({ default: mocks.masuk }))
vi.mock('@/services/surat-keluar.service', () => ({ default: mocks.keluar }))
vi.mock('@/services/approval.service', () => ({ default: { getPending: async () => [] }, approvalService: { getPending: async () => [] } }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: async () => [] } }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ImportFromGDrive', () => ({ default: () => null }))
vi.mock('@/components/ImportCsvDialog', () => ({ default: () => null }))
vi.mock('@/components/ImportFileDialog', () => ({ default: () => null }))

const halaman = (baris, page = 1) => ({ success: true, data: baris, pagination: { page, limit: 10, total: 45, totalPages: 5 } })
const SURAT_MASUK = [{ id: 'sm-1', nomorSurat: 'SM-1/2026', perihal: 'Undangan rapat', tanggalSurat: '2026-09-12', status: 'belum_dibalas', isArchived: false }]
const SURAT_KELUAR = [{ id: 'sk-1', nomorSurat: 'SK-1/2026', perihal: 'Nota dinas', tanggalSurat: '2026-09-12', approvalStatus: 'draft', createdBy: 'admin-a', isArchived: false }]

function Detail() {
    const navigate = useNavigate()
    return <button type="button" onClick={() => navigate(-1)}>Kembali</button>
}

// Dashboard → daftar → detail → Kembali, seperti di aplikasi.
function Aplikasi({ daftar, elemen }) {
    return (
        <MemoryRouter initialEntries={['/dashboard']}>
            <Routes>
                <Route path="/dashboard" element={<Link to={`/surat/${daftar}`}>Buka daftar</Link>} />
                <Route path={`/surat/${daftar}`} element={<>{elemen}<Link to="/dashboard">Ke dashboard</Link></>} />
                <Route path={`/surat/${daftar}/:id`} element={<Detail />} />
            </Routes>
        </MemoryRouter>
    )
}

// Detail dibuka dari menu tindakan baris, seperti di aplikasi.
async function bukaDetail(daftar) {
    fireEvent.keyDown(screen.getByRole('button', { name: `Buka menu tindakan surat ${daftar}` }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /Detail/ }))
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = { id: 'admin-a', role: 'admin_unit', unitKerjaId: 'unit-a' }
    mocks.masuk.getAll.mockImplementation(async params => halaman(SURAT_MASUK, params.page))
    mocks.masuk.getStats.mockResolvedValue({ total: 45, belumDibalas: 45, sudahDibalas: 0, diarsipkan: 0 })
    mocks.keluar.getAll.mockImplementation(async params => halaman(SURAT_KELUAR, params.page))
    mocks.keluar.getStats.mockResolvedValue({ total: 45, diarsipkan: 0 })
})
afterEach(cleanup)

describe('daftar Surat Masuk', () => {
    it('kembali dari detail membuka halaman dan pencarian yang sama', async () => {
        render(<Aplikasi daftar="masuk" elemen={<SuratMasuk />} />)
        fireEvent.click(screen.getByRole('link', { name: 'Buka daftar' }))
        await screen.findByText('SM-1/2026')
        expect(mocks.masuk.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: undefined }))

        fireEvent.change(screen.getByPlaceholderText(/cari/i), { target: { value: 'undangan' } })
        await waitFor(() => expect(mocks.masuk.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'undangan', page: 1 })), { timeout: 3000 })
        fireEvent.click(screen.getByRole('button', { name: 'Halaman berikutnya' }))
        await waitFor(() => expect(mocks.masuk.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'undangan', page: 2 })))

        await bukaDetail('masuk')
        fireEvent.click(await screen.findByRole('button', { name: 'Kembali' }))

        await screen.findByText('SM-1/2026')
        expect(mocks.masuk.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'undangan', page: 2 }))
        expect(screen.getByPlaceholderText(/cari/i)).toHaveValue('undangan')
        expect(screen.getByText('Halaman 2 dari 5')).toBeInTheDocument()
        // Pencarian yang dipulihkan tidak mengembalikan daftar ke halaman 1.
        await new Promise(resolve => setTimeout(resolve, 700))
        expect(mocks.masuk.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'undangan', page: 2 }))
    })

    it('membuka daftar dari menu mulai dari awal walau ada keadaan tersimpan', async () => {
        tulisKeadaanDaftar(kunciKeadaanDaftar({ userId: 'admin-a', daftar: 'surat-masuk' }), { page: 3, cari: 'lama', tahun: '2025' })
        render(<Aplikasi daftar="masuk" elemen={<SuratMasuk />} />)
        fireEvent.click(screen.getByRole('link', { name: 'Buka daftar' }))
        await screen.findByText('SM-1/2026')
        expect(mocks.masuk.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: undefined, tahun: undefined }))
    })

    it('muat ulang halaman memulihkan filter tersimpan, dan nilai yang tidak sah diabaikan', async () => {
        tulisKeadaanDaftar(kunciKeadaanDaftar({ userId: 'admin-a', daftar: 'surat-masuk' }), {
            page: 4, cari: 'tanah', tahun: '2025', sifatSurat: 'terbatas', urutan: 'tidak_dikenal',
            tanggalDari: '2025-02-01', tanggalSampai: '2025-13-45', unit: 'unit-lain',
        })
        render(<MemoryRouter initialEntries={['/surat/masuk']}><SuratMasuk /></MemoryRouter>)
        await screen.findByText('SM-1/2026')
        const params = mocks.masuk.getAll.mock.lastCall[0]
        expect(params).toMatchObject({ page: 4, search: 'tanah', tahun: '2025', sifatSurat: 'terbatas', tanggalDari: '2025-02-01', unitKerjaId: 'unit-a' })
        expect(params.tanggalSampai).toBeUndefined()
        expect(params.urutan).toBeUndefined()
    })

    it('keadaan pengguna lain tidak dipakai', async () => {
        tulisKeadaanDaftar(kunciKeadaanDaftar({ userId: 'admin-b', daftar: 'surat-masuk' }), { page: 3, cari: 'milik orang lain' })
        render(<MemoryRouter initialEntries={['/surat/masuk']}><SuratMasuk /></MemoryRouter>)
        await screen.findByText('SM-1/2026')
        expect(mocks.masuk.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: undefined }))
    })
})

describe('daftar Surat Keluar', () => {
    it('kembali dari detail membuka halaman yang sama', async () => {
        render(<Aplikasi daftar="keluar" elemen={<SuratKeluar />} />)
        fireEvent.click(screen.getByRole('link', { name: 'Buka daftar' }))
        await screen.findByText('SK-1/2026')
        fireEvent.click(screen.getByRole('button', { name: 'Halaman berikutnya' }))
        await waitFor(() => expect(mocks.keluar.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })))

        await bukaDetail('keluar')
        fireEvent.click(await screen.findByRole('button', { name: 'Kembali' }))

        await screen.findByText('SK-1/2026')
        expect(mocks.keluar.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
        expect(screen.getByText('Halaman 2 dari 5')).toBeInTheDocument()
    })

    it('jumlah baris per halaman ikut dipulihkan bersama halamannya', async () => {
        const kunci = kunciKeadaanDaftar({ userId: 'admin-a', daftar: 'surat-keluar' })
        tulisKeadaanDaftar(kunci, { page: 2, baris: 25 })
        const { unmount } = render(<MemoryRouter initialEntries={['/surat/keluar']}><SuratKeluar /></MemoryRouter>)
        await screen.findByText('SK-1/2026')
        expect(mocks.keluar.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 25 }))
        await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(kunci)).keadaan).toMatchObject({ page: 2, baris: 25 }))
        unmount()

        // Jumlah baris yang bukan salah satu pilihan tidak dipakai.
        tulisKeadaanDaftar(kunci, { page: 2, baris: 7 })
        render(<MemoryRouter initialEntries={['/surat/keluar']}><SuratKeluar /></MemoryRouter>)
        await screen.findByText('SK-1/2026')
        expect(mocks.keluar.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 10 }))
    })

    it('muat ulang memulihkan filter tersimpan; dari menu mulai dari awal', async () => {
        const kunci = kunciKeadaanDaftar({ userId: 'admin-a', daftar: 'surat-keluar' })
        tulisKeadaanDaftar(kunci, { page: 2, cari: 'nota', tahun: '2025', naskahDinas: 'Nota Dinas', urutan: 'tanggal_terlama' })
        const { unmount } = render(<MemoryRouter initialEntries={['/surat/keluar']}><SuratKeluar /></MemoryRouter>)
        await screen.findByText('SK-1/2026')
        expect(mocks.keluar.getAll).toHaveBeenLastCalledWith(expect.objectContaining({
            page: 2, search: 'nota', tahun: '2025', naskahDinas: 'Nota Dinas', urutan: 'tanggal_terlama',
        }))
        unmount()

        tulisKeadaanDaftar(kunci, { page: 2, cari: 'nota' })
        mocks.keluar.getAll.mockClear()
        render(<Aplikasi daftar="keluar" elemen={<SuratKeluar />} />)
        fireEvent.click(screen.getByRole('link', { name: 'Buka daftar' }))
        await screen.findByText('SK-1/2026')
        expect(mocks.keluar.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: undefined }))
    })
})
