import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// Tandai Selesai di halaman detail surat masuk: tombol yang sama dengan tab
// Perlu Dilengkapi, ditawarkan hanya bila jawaban server menunjukkan syarat
// POST /api/rangkaian/surat-masuk/:id/selesai terpenuhi.
const mocks = vi.hoisted(() => ({ getById: vi.fn(), tandaiSelesai: vi.fn(), toast: vi.fn(), bolehTulis: true, alur: vi.fn() }))
vi.mock('@/hooks/use-nama-unit-kerja', () => ({ useNamaUnitKerja: () => '' }))
vi.mock('@/components/tunjuk-silang/KartuTunjukSilang', () => ({ KartuTunjukSilang: () => null }))
vi.mock('@/services/surat-masuk.service', () => ({ default: { getById: mocks.getById, archive: vi.fn() } }))
vi.mock('@/services/distribution.service', () => ({ default: {} }))
vi.mock('@/services/rangkaian.service', () => ({ default: { tandaiSelesaiSuratMasuk: mocks.tandaiSelesai } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ canWrite: () => mocks.bolehTulis, user: { id: 'user-a', role: 'admin_unit', unitKerjaId: 'dir_bppt' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/ArchiveDialog', () => ({ ArchiveDialog: () => null }))
vi.mock('@/components/DistributeDialog', () => ({ DistributeDialog: () => null }))
vi.mock('@/components/surat-masuk/FilePreviewSection', () => ({ FilePreviewSection: () => null }))
vi.mock('@/components/surat/AlurSuratPanel', () => ({
    AlurSuratPanel: ({ muatUlangKe }) => { mocks.alur(muatUlangKe); return <output data-testid="alur">{`muat-ulang:${muatUlangKe}`}</output> },
}))

import SuratMasukDetail from './SuratMasukDetail'

// Bentuk galat services/api.js untuk AppError backend.
const galatApi = (status, message) => Object.assign(new Error(message), { status, data: { success: false, message }, response: { status, data: { success: false, message } } })
const surat = {
    id: 'sm-1', nomorSurat: 'SM-1/2026', perihal: 'Undangan rapat koordinasi', unitKerjaId: 'dir_bppt',
    dari: 'Kanwil A', tanggalSurat: '2026-09-01', status: 'belum_dibalas', sifatSurat: 'biasa', isArchived: false,
    aksesMelalui: 'owner', aksiDiizinkan: ['edit', 'disposisi', 'tautkan'], statusAlur: 'terdaftar', rangkaian: null, distribusiUnitSaya: null,
}
const CATATAN = 'Undangan rapat, sudah dihadiri.'

const renderDetail = async (data = surat) => {
    mocks.getById.mockResolvedValue(data)
    render(
        <MemoryRouter initialEntries={['/surat/masuk/sm-1']}>
            <Routes><Route path="/surat/masuk/:id" element={<SuratMasukDetail />} /></Routes>
        </MemoryRouter>,
    )
    await screen.findByRole('heading', { name: 'Detail Surat Masuk' })
}
const bukaDialog = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Tandai Selesai' }))
    return within(await screen.findByRole('dialog', { name: 'Tandai Selesai' }))
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.bolehTulis = true
})
afterEach(cleanup)

describe('tombol Tandai Selesai hanya tampil bila server akan menerimanya', () => {
    it('tampil untuk admin unit pemilik pada surat tanpa rangkaian yang belum ditindaklanjuti', async () => {
        await renderDetail()
        expect(screen.getByRole('button', { name: 'Tandai Selesai' })).toBeInTheDocument()
        expect(screen.getByText('Tidak perlu ditindaklanjuti?')).toBeInTheDocument()
    })

    it.each([
        ['surat sudah berada dalam rangkaian', { rangkaian: { id: 'r-1', kode: 'RS-1', status: 'aktif' } }],
        ['surat sudah didisposisikan', { statusAlur: 'didisposisikan' }],
        ['surat sudah ditindaklanjuti lewat balasan lama', { statusAlur: 'ditindaklanjuti' }],
        ['surat dibuka lewat jalur pengawas, bukan pemilik', { aksesMelalui: 'pengawas' }],
        ['surat dibuka lewat rangkaian unit lain', { aksesMelalui: 'peserta' }],
        ['jawaban lama tanpa keterangan rangkaian', { rangkaian: undefined }],
        ['jawaban lama tanpa status alur', { statusAlur: undefined }],
    ])('tidak tampil bila %s', async (_nama, ubahan) => {
        await renderDetail({ ...surat, ...ubahan })
        expect(screen.queryByRole('button', { name: 'Tandai Selesai' })).not.toBeInTheDocument()
        expect(screen.queryByText('Tidak perlu ditindaklanjuti?')).not.toBeInTheDocument()
    })

    it('tidak tampil bagi pengguna tanpa hak tulis di unit pemilik', async () => {
        mocks.bolehTulis = false
        await renderDetail()
        expect(screen.queryByRole('button', { name: 'Tandai Selesai' })).not.toBeInTheDocument()
    })
})

describe('dialog Tandai Selesai', () => {
    it('meminta catatan minimal 10 karakter, mengirimnya, lalu memuat ulang surat dan alurnya', async () => {
        mocks.tandaiSelesai.mockResolvedValue({ id: 'r-9', status: 'selesai', kode: 'RS-9', suratMasukId: 'sm-1' })
        await renderDetail()
        const dialog = await bukaDialog()
        expect(dialog.getByText(/Untuk surat SM-1\/2026 yang tidak perlu didisposisikan atau dibalas/)).toBeInTheDocument()

        const kirim = dialog.getByRole('button', { name: 'Tandai Selesai' })
        fireEvent.change(dialog.getByLabelText('Catatan penyelesaian'), { target: { value: 'pendek' } })
        expect(kirim).toBeDisabled()
        fireEvent.change(dialog.getByLabelText('Catatan penyelesaian'), { target: { value: `  ${CATATAN}  ` } })
        expect(kirim).toBeEnabled()

        // Setelah berhasil server mengembalikan surat yang sudah ber-rangkaian.
        mocks.getById.mockResolvedValue({ ...surat, status: 'sudah_dibalas', statusAlur: 'selesai', rangkaian: { id: 'r-9', kode: 'RS-9', status: 'selesai' } })
        fireEvent.click(kirim)

        await waitFor(() => expect(mocks.tandaiSelesai).toHaveBeenCalledWith('sm-1', CATATAN))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
            title: 'Surat ditandai selesai',
            description: 'Status surat menjadi Sudah Dibalas dan surat kini ada di Siap diberkaskan.',
        }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        await waitFor(() => expect(mocks.getById).toHaveBeenCalledTimes(2))
        // Muat ulang bersifat diam, alur surat ikut dimuat ulang, dan tombol tidak ditawarkan lagi.
        expect(screen.queryByText('Memuat data surat...')).toBeNull()
        await waitFor(() => expect(screen.getByTestId('alur')).toHaveTextContent('muat-ulang:1'))
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Tandai Selesai' })).not.toBeInTheDocument())
        expect(mocks.tandaiSelesai).toHaveBeenCalledTimes(1)
    })

    it('409 menampilkan pesan server di dalam dialog dan memuat ulang halaman', async () => {
        const pesan = 'Surat ini sudah berada dalam rangkaian. Buka Alur Surat pada detail surat, lalu pilih Tandai Selesai di sana.'
        mocks.tandaiSelesai.mockRejectedValue(galatApi(409, pesan))
        await renderDetail()
        const dialog = await bukaDialog()
        fireEvent.change(dialog.getByLabelText('Catatan penyelesaian'), { target: { value: CATATAN } })
        mocks.getById.mockResolvedValue({ ...surat, rangkaian: { id: 'r-2', kode: 'RS-2', status: 'aktif' } })
        fireEvent.click(dialog.getByRole('button', { name: 'Tandai Selesai' }))

        expect(await dialog.findByRole('alert')).toHaveTextContent(pesan)
        await waitFor(() => expect(mocks.getById).toHaveBeenCalledTimes(2))
        await waitFor(() => expect(screen.getByTestId('alur')).toHaveTextContent('muat-ulang:1'))
        // Dialog dan pesannya tetap terbaca meski kartu tombol sudah hilang.
        expect(dialog.getByRole('alert')).toHaveTextContent(pesan)
        expect(screen.queryByText('Tidak perlu ditindaklanjuti?')).not.toBeInTheDocument()
        expect(mocks.toast).not.toHaveBeenCalled()
    })

    it('403 menampilkan pesan server dan tidak memuat ulang surat', async () => {
        const pesan = 'Akses hanya-baca. Anda tidak dapat mengubah data.'
        mocks.tandaiSelesai.mockRejectedValue(galatApi(403, pesan))
        await renderDetail()
        const dialog = await bukaDialog()
        fireEvent.change(dialog.getByLabelText('Catatan penyelesaian'), { target: { value: CATATAN } })
        fireEvent.click(dialog.getByRole('button', { name: 'Tandai Selesai' }))

        expect(await dialog.findByRole('alert')).toHaveTextContent(pesan)
        expect(mocks.getById).toHaveBeenCalledTimes(1)
        expect(screen.getByTestId('alur')).toHaveTextContent('muat-ulang:0')
        expect(mocks.toast).not.toHaveBeenCalled()
        // Batal menutup dialog tanpa mengirim ulang.
        fireEvent.click(dialog.getByRole('button', { name: 'Batal' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(mocks.tandaiSelesai).toHaveBeenCalledTimes(1)
    })
})
