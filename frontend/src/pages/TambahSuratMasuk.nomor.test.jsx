import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratMasuk from './TambahSuratMasuk'
import { clearOfflineStorage } from '@/lib/offline-storage'

// No. Agenda yang diketik saat mendaftarkan dan catatan pindah tahun saat mengubah.

const mocks = vi.hoisted(() => ({
    masuk: { create: vi.fn(), getNextNumber: vi.fn(), getById: vi.fn(), update: vi.fn() },
    dist: { getDistributableUnits: vi.fn(), getOpsi: vi.fn() },
    lacak: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-tu', role: 'admin_unit', unitKerjaId: 'sesditjen' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }))
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: mocks.masuk }))
vi.mock('@/services/distribution.service', () => ({ default: mocks.dist, distributionService: mocks.dist }))
vi.mock('@/services/rangkaian.service', () => ({ rangkaianService: { lacak: mocks.lacak }, default: { lacak: mocks.lacak } }))
vi.mock('@/components/ui/searchable-select', () => ({
    SearchableSelect: ({ id, ariaLabel, value, onValueChange, options }) => (
        <select id={id} aria-label={ariaLabel} value={value} onChange={event => onValueChange(event.target.value)}>
            <option value="">Pilih</option>
            {options.map(option => {
                const item = typeof option === 'string' ? { value: option, label: option } : option
                return <option key={item.value} value={item.value}>{item.label}</option>
            })}
        </select>
    ),
}))

const tersimpan = {
    id: 'sm-1', unitKerjaId: 'sesditjen', jenisSurat: 'Nota Dinas', sifatSurat: 'biasa', nomorSurat: 'SM-1/2026',
    tanggalSurat: '2026-09-11', tahun: 2026, noUrut: 14, perihal: 'Perihal tersimpan', dari: 'Kanwil A', kepada: 'Direktur',
    disposisi: ['Ditjen'], linkDokumen: null, filePath: null, aksiDiizinkan: ['edit'], updatedAt: '2026-09-11T08:00:00.123Z',
}
let router

beforeEach(async () => {
    vi.clearAllMocks()
    await clearOfflineStorage()
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    mocks.masuk.create.mockResolvedValue({ data: { id: 'sm-baru' } })
    mocks.masuk.update.mockResolvedValue({ id: 'sm-1' })
    mocks.masuk.getNextNumber.mockImplementation(async ({ noUrut }) => ({ nextNumber: 9, nomorSurat: `${String(noUrut ?? 9).padStart(3, '0')}/SM/2026` }))
    mocks.masuk.getById.mockResolvedValue(tersimpan)
    mocks.dist.getDistributableUnits.mockResolvedValue([])
    mocks.dist.getOpsi.mockResolvedValue({ instruksi: [], jalurAksesTerkendali: false })
    mocks.lacak.mockResolvedValue({ kelompok: [] })
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function tampil(entry) {
    router = createMemoryRouter([
        { path: '/surat/masuk/tambah', element: <TambahSuratMasuk /> },
        { path: '/surat/masuk/edit/:id', element: <TambahSuratMasuk /> },
        { path: '/surat/masuk', element: <h1>Daftar</h1> },
    ], { initialEntries: [entry] })
    return render(<RouterProvider router={router} />)
}

// Isian wajib di sini tidak memuat disposisi; dialog konfirmasinya dijawab Simpan tanpa disposisi.
async function kirimTanpaDisposisi(view) {
    fireEvent.submit(view.container.querySelector('form'))
    fireEvent.click(await screen.findByRole('button', { name: 'Simpan tanpa disposisi' }))
}

function isiWajib() {
    fireEvent.change(screen.getByRole('combobox', { name: 'Jenis surat' }), { target: { value: 'Nota Dinas' } })
    fireEvent.change(screen.getByLabelText(/Tanggal Surat/), { target: { value: '2026-09-23' } })
    fireEvent.change(screen.getByLabelText(/^Perihal/), { target: { value: 'Permohonan data' } })
    fireEvent.change(screen.getByLabelText(/^Dari \(Pengirim\)/), { target: { value: 'Pemda Sintetis' } })
    fireEvent.change(screen.getByLabelText(/^Kepada \(Penerima\)/), { target: { value: 'Direktur Jenderal' } })
}

describe('No. Agenda pada Tambah Surat Masuk', () => {
    it('mengirim No. Agenda yang diketik dan pratinjau nomor surat memakainya', async () => {
        const view = tampil('/surat/masuk/tambah')
        expect(screen.getByText('Kosongkan untuk nomor otomatis. Isi bila ingin melanjutkan nomor dari buku agenda kantor.')).toBeInTheDocument()
        isiWajib()
        fireEvent.change(screen.getByLabelText('No. Agenda'), { target: { value: '345' } })
        expect(await screen.findByText('345/SM/2026')).toBeInTheDocument()
        expect(mocks.masuk.getNextNumber).toHaveBeenLastCalledWith(expect.objectContaining({ tanggalSurat: '2026-09-23', noUrut: 345 }))
        await kirimTanpaDisposisi(view)
        // 345 jauh di atas nomor otomatis berikutnya (9).
        fireEvent.click(await screen.findByRole('button', { name: 'Simpan dengan nomor ini' }))
        await waitFor(() => expect(mocks.masuk.create).toHaveBeenCalled())
        expect(mocks.masuk.create.mock.calls[0][0]).toMatchObject({ noUrut: 345, tahun: 2026 })
    })

    it('tanpa No. Agenda tidak mengirim nomor sehingga server memberi nomor otomatis', async () => {
        const view = tampil('/surat/masuk/tambah')
        isiWajib()
        expect(await screen.findByText('009/SM/2026')).toBeInTheDocument()
        await kirimTanpaDisposisi(view)
        await waitFor(() => expect(mocks.masuk.create).toHaveBeenCalled())
        expect(mocks.masuk.create.mock.calls[0][0]).not.toHaveProperty('noUrut')
    })

    it.each(['0', '12a', '-5'])('menolak No. Agenda %j sebelum mengirim', async nilai => {
        const view = tampil('/surat/masuk/tambah')
        isiWajib()
        fireEvent.change(screen.getByLabelText('No. Agenda'), { target: { value: nilai } })
        fireEvent.submit(view.container.querySelector('form'))
        expect(await screen.findByRole('alert')).toHaveTextContent('No. Agenda harus berupa angka 1 sampai 999999')
        expect(screen.getByLabelText('No. Agenda')).toHaveAttribute('aria-invalid', 'true')
        expect(mocks.masuk.create).not.toHaveBeenCalled()
    })

    it('menampilkan pesan server bila No. Agenda sudah dipakai, tanpa tombol Muat ulang', async () => {
        const pesan = 'No. Agenda 345 tahun 2026 sudah dipakai surat lain di unit ini. No. Agenda milik surat yang sudah dihapus juga tidak dapat dipakai ulang. Kosongkan No. Agenda untuk nomor otomatis atau isi nomor lain.'
        mocks.masuk.create.mockRejectedValue(Object.assign(new Error(pesan), { status: 409, data: { error: 'ConflictError', message: pesan, code: 'CONFLICT' } }))
        const view = tampil('/surat/masuk/tambah')
        isiWajib()
        fireEvent.change(screen.getByLabelText('No. Agenda'), { target: { value: '345' } })
        await kirimTanpaDisposisi(view)
        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent(pesan)
        expect(within(alert).queryByRole('button', { name: 'Muat ulang' })).toBeNull()
    })
})

describe('Edit Surat Masuk: tahun surat', () => {
    async function tampilEdit() {
        const view = tampil('/surat/masuk/edit/sm-1')
        await screen.findByDisplayValue('Perihal tersimpan')
        return view
    }

    it('tanpa isian No. Agenda; catatan muncul bila tahun tanggal surat berubah', async () => {
        await tampilEdit()
        expect(screen.queryByLabelText('No. Agenda')).toBeNull()
        fireEvent.change(screen.getByLabelText(/Tanggal Surat/), { target: { value: '2026-12-01' } })
        expect(screen.queryByText(/Tahun berubah/)).toBeNull()
        fireEvent.change(screen.getByLabelText(/Tanggal Surat/), { target: { value: '2025-12-30' } })
        expect(screen.getByText('Tahun berubah. Surat akan mendapat nomor agenda baru di tahun 2025; nomor surat yang dibuat otomatis ikut diperbarui.')).toBeInTheDocument()
        fireEvent.change(screen.getByLabelText(/Tanggal Surat/), { target: { value: '2026-09-11' } })
        expect(screen.queryByText(/Tahun berubah/)).toBeNull()
    })

    it('mengirim tanggal baru tanpa tahun dan nomor; server yang memindahkan urutannya', async () => {
        const view = await tampilEdit()
        fireEvent.change(screen.getByLabelText(/Tanggal Surat/), { target: { value: '2025-12-30' } })
        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(mocks.masuk.update).toHaveBeenCalled())
        const payload = mocks.masuk.update.mock.calls[0][1]
        expect(payload).toMatchObject({ tanggalSurat: '2025-12-30' })
        expect(payload).not.toHaveProperty('tahun')
        expect(payload).not.toHaveProperty('noUrut')
    })
})

describe('nomor otomatis berikutnya dan rentang tahun', () => {
    const PESAN_JAUH = 'Nomor yang diisi jauh di atas nomor otomatis berikutnya (9). Nomor setelahnya akan melanjutkan dari angka ini dan tidak dapat diturunkan lagi. Lanjutkan?'

    it('menampilkan nomor otomatis berikutnya di bawah isian No. Agenda', async () => {
        tampil('/surat/masuk/tambah')
        isiWajib()
        expect(await screen.findByText('Nomor otomatis berikutnya: 9')).toBeInTheDocument()
    })

    it('No. Agenda lebih dari 100 di atas nomor otomatis meminta konfirmasi; bila dibatalkan tidak disimpan', async () => {
        const view = tampil('/surat/masuk/tambah')
        isiWajib()
        fireEvent.change(screen.getByLabelText('No. Agenda'), { target: { value: '110' } })
        expect(await screen.findByText('110/SM/2026')).toBeInTheDocument()
        await kirimTanpaDisposisi(view)
        const dialog = await screen.findByRole('alertdialog', { name: 'Simpan dengan nomor ini?' })
        expect(dialog).toHaveTextContent(PESAN_JAUH)
        fireEvent.click(within(dialog).getByRole('button', { name: 'Ubah nomor' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        expect(mocks.masuk.create).not.toHaveBeenCalled()

        await kirimTanpaDisposisi(view)
        fireEvent.click(await screen.findByRole('button', { name: 'Simpan dengan nomor ini' }))
        await waitFor(() => expect(mocks.masuk.create).toHaveBeenCalled())
        expect(mocks.masuk.create.mock.calls[0][0]).toMatchObject({ noUrut: 110 })
    })

    it('nomor sampai 100 di atas nomor otomatis disimpan tanpa konfirmasi tambahan', async () => {
        const view = tampil('/surat/masuk/tambah')
        isiWajib()
        fireEvent.change(screen.getByLabelText('No. Agenda'), { target: { value: '109' } })
        expect(await screen.findByText('109/SM/2026')).toBeInTheDocument()
        await kirimTanpaDisposisi(view)
        await waitFor(() => expect(mocks.masuk.create).toHaveBeenCalled())
        expect(screen.queryByRole('alertdialog', { name: 'Simpan dengan nomor ini?' })).toBeNull()
    })

    it('tanggal di luar 2000-2100 ditolak saat mencatat; isian tanggal dibatasi', async () => {
        const view = tampil('/surat/masuk/tambah')
        expect(screen.getByLabelText(/Tanggal Surat/)).toHaveAttribute('min', '2000-01-01')
        expect(screen.getByLabelText(/Tanggal Surat/)).toHaveAttribute('max', '2100-12-31')
        isiWajib()
        fireEvent.change(screen.getByLabelText(/Tanggal Surat/), { target: { value: '1999-12-31' } })
        fireEvent.submit(view.container.querySelector('form'))
        expect(await screen.findByRole('alert')).toHaveTextContent('Tahun harus antara 2000 dan 2100')
        expect(mocks.masuk.create).not.toHaveBeenCalled()
    })

    it('pindah ke tahun di luar 2000-2100 ditolak saat mengubah', async () => {
        const view = tampil('/surat/masuk/edit/sm-1')
        await screen.findByDisplayValue('Perihal tersimpan')
        fireEvent.change(screen.getByLabelText(/Tanggal Surat/), { target: { value: '2101-01-02' } })
        fireEvent.submit(view.container.querySelector('form'))
        expect(await screen.findByRole('alert')).toHaveTextContent('Tahun harus antara 2000 dan 2100')
        expect(mocks.masuk.update).not.toHaveBeenCalled()
    })
})
