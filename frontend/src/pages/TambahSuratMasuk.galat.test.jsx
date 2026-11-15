import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratMasuk from './TambahSuratMasuk'
import { clearOfflineStorage } from '@/lib/offline-storage'

// Galat validasi server ditampilkan per isian dengan ringkasan berbahasa
// Indonesia, baik saat mendaftarkan maupun mengubah surat masuk.

const mocks = vi.hoisted(() => ({
    masuk: { create: vi.fn(), getNextNumber: vi.fn(), getById: vi.fn(), update: vi.fn() },
    dist: { getDistributableUnits: vi.fn(), getOpsi: vi.fn() },
    lacak: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-tu', role: 'admin_unit', unitKerjaId: 'sesditjen' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: true } }) }))
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: mocks.masuk }))
vi.mock('@/services/distribution.service', () => ({ default: mocks.dist, distributionService: mocks.dist }))
vi.mock('@/services/rangkaian.service', () => ({ rangkaianService: { lacak: mocks.lacak }, default: { lacak: mocks.lacak } }))
vi.mock('@/components/ui/searchable-select', () => ({
    SearchableSelect: ({ id, ariaLabel, value, onValueChange, options, ...rest }) => (
        <select id={id} aria-label={ariaLabel} aria-invalid={rest['aria-invalid']} aria-describedby={rest['aria-describedby']}
            value={value} onChange={event => onValueChange(event.target.value)}>
            <option value="">Pilih</option>
            {options.map(option => {
                const item = typeof option === 'string' ? { value: option, label: option } : option
                return <option key={item.value} value={item.value}>{item.label}</option>
            })}
        </select>
    ),
}))

const galatValidasi = details => Object.assign(new Error('Validation failed'), { status: 400, details })
const tersimpan = {
    id: 'sm-1', unitKerjaId: 'sesditjen', jenisSurat: 'Nota Dinas', sifatSurat: 'biasa', nomorSurat: 'SM-1/2026',
    tanggalSurat: '2026-09-11', perihal: 'Perihal tersimpan', dari: 'Kanwil A', kepada: 'Direktur',
    disposisi: ['Ditjen'], linkDokumen: null, filePath: null, aksiDiizinkan: ['edit'],
}
let router

beforeEach(async () => {
    vi.clearAllMocks()
    await clearOfflineStorage()
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    mocks.masuk.getNextNumber.mockResolvedValue({ nomorSurat: '001/SM/2026' })
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

describe('galat validasi server pada formulir surat masuk', () => {
    it('saat mendaftarkan: pesan tampil di samping isiannya, bukan "Validation failed"', async () => {
        mocks.masuk.create.mockRejectedValue(galatValidasi([
            { field: 'perihal', message: 'Perihal maksimal 2000 karakter' },
            { field: 'dari', message: 'Pengirim maksimal 255 karakter' },
            { field: 'tanggalSurat', message: 'Tanggal tidak valid' },
            { field: 'disposisi.targets.0.batasWaktu', message: 'Batas waktu tidak boleh sebelum hari ini' },
        ]))
        const view = tampil('/surat/masuk/tambah')
        fireEvent.change(screen.getByRole('combobox', { name: 'Jenis surat' }), { target: { value: 'Nota Dinas' } })
        fireEvent.change(screen.getByLabelText(/Tanggal Surat/), { target: { value: '2026-09-23' } })
        fireEvent.change(screen.getByLabelText(/^Perihal/), { target: { value: 'Permohonan data' } })
        fireEvent.change(screen.getByLabelText(/^Dari \(Pengirim\)/), { target: { value: 'Pemda Sintetis' } })
        fireEvent.change(screen.getByLabelText(/^Kepada \(Penerima\)/), { target: { value: 'Direktur Jenderal' } })
        fireEvent.submit(view.container.querySelector('form'))
        fireEvent.click(await screen.findByRole('button', { name: 'Simpan tanpa disposisi' }))

        const ringkasan = await screen.findByRole('alert')
        expect(ringkasan).toHaveTextContent('Surat belum dapat disimpan. Periksa isian berikut: Perihal maksimal 2000 karakter; Pengirim maksimal 255 karakter; Tanggal tidak valid; Batas waktu tidak boleh sebelum hari ini')
        expect(screen.queryByText(/Validation failed/)).toBeNull()
        expect(screen.getByLabelText(/^Perihal/)).toHaveAccessibleDescription('Perihal maksimal 2000 karakter')
        expect(screen.getByLabelText(/^Perihal/)).toHaveAttribute('aria-invalid', 'true')
        expect(screen.getByLabelText(/^Dari \(Pengirim\)/)).toHaveAccessibleDescription('Pengirim maksimal 255 karakter')
        expect(screen.getByLabelText(/Tanggal Surat/)).toHaveAccessibleDescription('Tanggal tidak valid')
        expect(screen.getAllByText('Batas waktu tidak boleh sebelum hari ini').length).toBeGreaterThan(0)
        // Lampiran opsional: permintaan tetap terkirim walau link dan berkas kosong.
        expect(mocks.masuk.create).toHaveBeenCalledTimes(1)
        expect(mocks.masuk.create.mock.calls[0][1]).toBeNull()

        fireEvent.change(screen.getByLabelText(/^Perihal/), { target: { value: 'Permohonan data ringkas' } })
        expect(screen.getByLabelText(/^Perihal/)).not.toHaveAttribute('aria-invalid', 'true')
    })

    it('saat mengubah: pesan link dokumen dan alasan koreksi tampil pada isiannya', async () => {
        mocks.masuk.getById.mockResolvedValue({ ...tersimpan, rangkaian: { id: 'r1', kode: 'RS-2026-000001', status: 'aktif' } })
        mocks.masuk.update.mockRejectedValue(galatValidasi([
            { field: 'nomorSurat', message: 'Nomor surat maksimal 255 karakter' },
            { field: 'alasan', message: 'Alasan minimal 10 karakter' },
        ]))
        const view = tampil('/surat/masuk/edit/sm-1')
        await screen.findByDisplayValue('Perihal tersimpan')
        fireEvent.change(document.getElementById('nomor-surat'), { target: { value: 'SM-1A/2026' } })
        fireEvent.change(screen.getByLabelText(/^Alasan koreksi/), { target: { value: 'Salah ketik nomor surat' } })
        fireEvent.submit(view.container.querySelector('form'))

        await waitFor(() => expect(mocks.masuk.update).toHaveBeenCalledTimes(1))
        expect(await screen.findByRole('alert')).toHaveTextContent('Surat belum dapat disimpan. Periksa isian berikut: Nomor surat maksimal 255 karakter; Alasan minimal 10 karakter')
        expect(screen.queryByText(/Validation failed/)).toBeNull()
        expect(document.getElementById('nomor-surat')).toHaveAccessibleDescription('Nomor surat maksimal 255 karakter')
        expect(screen.getByLabelText(/^Alasan koreksi/)).toHaveAccessibleDescription('Alasan minimal 10 karakter')
    })

    it('galat validasi tanpa rincian tetap memakai ringkasan berbahasa Indonesia', async () => {
        mocks.masuk.update.mockRejectedValue(galatValidasi(undefined))
        const view = tampil('/surat/masuk/edit/sm-1')
        await screen.findByDisplayValue('Perihal tersimpan')
        fireEvent.submit(view.container.querySelector('form'))
        expect(await screen.findByRole('alert')).toHaveTextContent('Gagal menyimpan surat masuk. Periksa kembali isian Anda, lalu coba lagi.')
        expect(screen.queryByText(/Validation failed/)).toBeNull()
    })
})
