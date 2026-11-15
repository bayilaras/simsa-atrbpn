import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratMasuk from './TambahSuratMasuk'
import { clearOfflineStorage } from '@/lib/offline-storage'
import { hariIniJakarta } from '@/lib/tindak-lanjut'

// Tanggal diterima: terisi hari ini saat mencatat, dapat diubah, dan diperiksa sebelum dikirim.

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

describe('Tanggal Diterima pada Tambah dan Edit Surat Masuk', () => {
    it('terisi hari ini (WIB) dan ikut terkirim saat mencatat', async () => {
        const view = tampil('/surat/masuk/tambah')
        const isian = screen.getByLabelText('Tanggal Diterima')
        expect(isian).toHaveValue(hariIniJakarta())
        expect(isian).toHaveAttribute('max', hariIniJakarta())
        expect(screen.getByText('Tanggal surat sampai di kantor. Terisi hari ini; ubah bila surat diterima di hari lain.')).toBeInTheDocument()
        isiWajib()
        fireEvent.change(isian, { target: { value: '2026-09-24' } })
        await kirimTanpaDisposisi(view)
        await waitFor(() => expect(mocks.masuk.create).toHaveBeenCalled())
        expect(mocks.masuk.create.mock.calls[0][0]).toMatchObject({ tanggalSurat: '2026-09-23', tanggalDiterima: '2026-09-24' })
    })

    it('menolak tanggal diterima sebelum tanggal surat sebelum mengirim', async () => {
        const view = tampil('/surat/masuk/tambah')
        isiWajib()
        fireEvent.change(screen.getByLabelText('Tanggal Diterima'), { target: { value: '2026-09-20' } })
        fireEvent.submit(view.container.querySelector('form'))
        expect(await screen.findByRole('alert')).toHaveTextContent('Tanggal diterima tidak boleh sebelum tanggal surat')
        expect(screen.getByLabelText('Tanggal Diterima')).toHaveAttribute('aria-invalid', 'true')
        expect(mocks.masuk.create).not.toHaveBeenCalled()
    })

    it('boleh dikosongkan', async () => {
        const view = tampil('/surat/masuk/tambah')
        isiWajib()
        fireEvent.change(screen.getByLabelText('Tanggal Diterima'), { target: { value: '' } })
        await kirimTanpaDisposisi(view)
        await waitFor(() => expect(mocks.masuk.create).toHaveBeenCalled())
        expect(mocks.masuk.create.mock.calls[0][0].tanggalDiterima).toBe('')
    })

    it('surat lama tanpa tanggal diterima tampil kosong saat diubah; isian baru ikut terkirim', async () => {
        const view = tampil('/surat/masuk/edit/sm-1')
        await screen.findByDisplayValue('Perihal tersimpan')
        expect(screen.getByLabelText('Tanggal Diterima')).toHaveValue('')
        fireEvent.change(screen.getByLabelText('Tanggal Diterima'), { target: { value: '2026-09-12' } })
        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(mocks.masuk.update).toHaveBeenCalled())
        expect(mocks.masuk.update.mock.calls[0][1]).toMatchObject({ tanggalDiterima: '2026-09-12' })
    })
})
