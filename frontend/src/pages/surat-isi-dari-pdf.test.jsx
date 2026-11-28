import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratMasuk from './TambahSuratMasuk'
import TambahSuratKeluar from './TambahSuratKeluar'
import { clearOfflineStorage } from '@/lib/offline-storage'

// Isi formulir surat dari PDF yang dipilih: hanya saat mencatat surat baru,
// hanya bila server melaporkan modulnya aktif, dan tidak pernah menimpa ketikan.

const mocks = vi.hoisted(() => ({
    capabilities: { files: true, fileUploads: true, letterFileUploads: true, letterPdfPrefill: true },
    masuk: { create: vi.fn(), getNextNumber: vi.fn(), getById: vi.fn(), update: vi.fn() },
    keluar: { create: vi.fn(), getNextNumber: vi.fn(), getById: vi.fn(), update: vi.fn() },
    dist: { getDistributableUnits: vi.fn(), getOpsi: vi.fn() },
    lacak: vi.fn(),
    bacaTeksPdf: vi.fn(),
    bacaIsian: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-tu', role: 'admin_unit', unitKerjaId: 'sesditjen' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: mocks.capabilities }) }))
vi.mock('@/hooks/use-required-unit-kerja-scope', () => ({
    useRequiredUnitKerjaScope: () => ({ isSuperAdmin: false, unitKerjaId: 'sesditjen', loading: false }),
}))
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: mocks.masuk }))
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: mocks.keluar }))
vi.mock('@/services/distribution.service', () => ({ default: mocks.dist, distributionService: mocks.dist }))
vi.mock('@/services/rangkaian.service', () => ({ rangkaianService: { lacak: mocks.lacak }, default: { lacak: mocks.lacak } }))
vi.mock('@/lib/teks-pdf', () => ({ bacaTeksPdf: mocks.bacaTeksPdf }))
vi.mock('@/services/letter-prefill.service', () => ({ letterPrefillService: { bacaIsian: mocks.bacaIsian } }))
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

const TERBACA = {
    nomorSurat: 'B/123/CTH.01/XI/2026',
    tanggalSurat: '2026-11-12',
    perihal: 'Permintaan Data Contoh',
    pengirim: 'Direktur Jenderal Contoh',
    penerima: 'Kepala Kantor Wilayah Contoh',
    jenisSurat: 'Nota Dinas',
}
const pdf = () => new File(['%PDF-1.4 contoh'], 'surat-contoh.pdf', { type: 'application/pdf' })
let router

beforeEach(async () => {
    vi.clearAllMocks()
    await clearOfflineStorage()
    sessionStorage.clear()
    Object.assign(mocks.capabilities, { files: true, fileUploads: true, letterFileUploads: true, letterPdfPrefill: true })
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    mocks.masuk.getNextNumber.mockResolvedValue({ nextNumber: 9, nomorSurat: '009/SM/2026' })
    mocks.keluar.getNextNumber.mockResolvedValue({ nomorSurat: '001/X/11/2026' })
    mocks.masuk.getById.mockResolvedValue({
        id: 'sm-1', unitKerjaId: 'sesditjen', jenisSurat: 'Surat Dinas', sifatSurat: 'biasa', nomorSurat: 'SM-1/2026',
        tanggalSurat: '2026-09-11', tahun: 2026, noUrut: 14, perihal: 'Perihal tersimpan', dari: 'Kanwil A', kepada: 'Direktur',
        disposisi: [], linkDokumen: null, filePath: null, aksiDiizinkan: ['edit'], updatedAt: '2026-09-11T08:00:00.123Z',
    })
    mocks.dist.getDistributableUnits.mockResolvedValue([])
    mocks.dist.getOpsi.mockResolvedValue({ instruksi: [], jalurAksesTerkendali: false })
    mocks.lacak.mockResolvedValue({ kelompok: [] })
    mocks.bacaTeksPdf.mockResolvedValue('Nomor : B/123/CTH.01/XI/2026')
    mocks.bacaIsian.mockResolvedValue(TERBACA)
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function tampil(entry) {
    router = createMemoryRouter([
        { path: '/surat/masuk/tambah', element: <TambahSuratMasuk /> },
        { path: '/surat/masuk/edit/:id', element: <TambahSuratMasuk /> },
        { path: '/surat/masuk', element: <h1>Daftar</h1> },
        { path: '/surat/keluar/tambah', element: <TambahSuratKeluar /> },
        { path: '/surat/keluar', element: <h1>Daftar</h1> },
    ], { initialEntries: [entry] })
    return render(<RouterProvider router={router} />)
}

const pilihBerkas = (id) => fireEvent.change(document.getElementById(id), { target: { files: [pdf()] } })

describe('isi formulir surat masuk dari PDF', () => {
    it('membaca berkas yang dipilih dan mengisi isian kosong atas perintah petugas', async () => {
        tampil('/surat/masuk/tambah')
        expect(screen.getByText('Punya PDF suratnya?')).toBeInTheDocument()
        expect(screen.getByRole('combobox', { name: 'Sifat surat' })).toHaveValue('biasa')

        pilihBerkas('berkas-surat-masuk')
        fireEvent.click(await screen.findByRole('button', { name: 'Isi formulir' }))

        expect(screen.getByRole('combobox', { name: 'Jenis surat' })).toHaveValue('Nota Dinas')
        expect(document.getElementById('nomor-surat')).toHaveValue('B/123/CTH.01/XI/2026')
        expect(document.getElementById('tanggal-surat')).toHaveValue('2026-11-12')
        expect(document.getElementById('perihal-surat')).toHaveValue('Permintaan Data Contoh')
        expect(document.getElementById('pengirim-surat')).toHaveValue('Direktur Jenderal Contoh')
        expect(document.getElementById('penerima-surat')).toHaveValue('Kepala Kantor Wilayah Contoh')
        // Sifat surat tetap pilihan petugas.
        expect(screen.getByRole('combobox', { name: 'Sifat surat' })).toHaveValue('biasa')
        expect(screen.getByText('6 isian diisi dari berkas. Periksa kembali sebelum menyimpan.')).toBeInTheDocument()
        expect(mocks.bacaTeksPdf.mock.calls[0][0].name).toBe('surat-contoh.pdf')
        expect(mocks.masuk.create).not.toHaveBeenCalled()
    })

    it('tidak mengubah isian apa pun sebelum tombol ditekan dan tidak menimpa ketikan', async () => {
        tampil('/surat/masuk/tambah')
        fireEvent.change(document.getElementById('perihal-surat'), { target: { value: 'Perihal ketikan petugas' } })
        pilihBerkas('berkas-surat-masuk')
        const tombol = await screen.findByRole('button', { name: 'Isi formulir' })
        expect(document.getElementById('nomor-surat')).toHaveValue('')

        fireEvent.click(tombol)
        expect(document.getElementById('perihal-surat')).toHaveValue('Perihal ketikan petugas')
        expect(document.getElementById('nomor-surat')).toHaveValue('B/123/CTH.01/XI/2026')
        expect(screen.getByText('5 isian diisi dari berkas. Periksa kembali sebelum menyimpan.')).toBeInTheDocument()
    })

    it('PDF hasil pindai hanya memberi keterangan; formulir tetap dapat diisi', async () => {
        mocks.bacaTeksPdf.mockResolvedValue('')
        tampil('/surat/masuk/tambah')
        pilihBerkas('berkas-surat-masuk')
        expect(await screen.findByText(/tidak memuat teks yang dapat dibaca/)).toBeInTheDocument()
        expect(mocks.bacaIsian).not.toHaveBeenCalled()
        expect(screen.getByText('surat-contoh.pdf')).toBeInTheDocument()
    })

    it.each([
        ['server tidak melaporkan modulnya', { letterPdfPrefill: undefined }],
        ['modulnya dimatikan', { letterPdfPrefill: false }],
        ['nilainya bukan true', { letterPdfPrefill: 'true' }],
        ['unggah berkas surat tidak tersedia', { letterFileUploads: false }],
    ])('tidak ditawarkan bila %s', async (_nama, ubah) => {
        Object.assign(mocks.capabilities, ubah)
        tampil('/surat/masuk/tambah')
        expect(screen.queryByText('Punya PDF suratnya?')).toBeNull()
        const masukan = document.getElementById('berkas-surat-masuk')
        if (masukan) {
            pilihBerkas('berkas-surat-masuk')
            await screen.findByText('surat-contoh.pdf')
        }
        expect(mocks.bacaTeksPdf).not.toHaveBeenCalled()
        expect(mocks.bacaIsian).not.toHaveBeenCalled()
    })

    it('tidak ditawarkan saat mengubah surat yang sudah tercatat', async () => {
        tampil('/surat/masuk/edit/sm-1')
        await screen.findByDisplayValue('Perihal tersimpan')
        expect(screen.queryByText('Punya PDF suratnya?')).toBeNull()
        pilihBerkas('berkas-surat-masuk')
        await screen.findByText('surat-contoh.pdf')
        expect(mocks.bacaTeksPdf).not.toHaveBeenCalled()
    })
})

describe('isi formulir surat keluar dari PDF', () => {
    it('mengisi Naskah Dinas, nomor, tanggal, perihal, dan Kepada', async () => {
        tampil('/surat/keluar/tambah')
        expect(screen.getByText('Punya PDF suratnya?')).toBeInTheDocument()
        pilihBerkas('berkas-surat-keluar')
        fireEvent.click(await screen.findByRole('button', { name: 'Isi formulir' }))

        await waitFor(() => expect(document.getElementById('naskah-dinas')).toHaveValue('Nota Dinas'))
        expect(document.getElementById('nomor-surat-keluar')).toHaveValue('B/123/CTH.01/XI/2026')
        expect(document.getElementById('tanggal-surat-keluar')).toHaveValue('2026-11-12')
        expect(document.getElementById('perihal-surat-keluar')).toHaveValue('Permintaan Data Contoh')
        expect(document.getElementById('penerima-surat-keluar')).toHaveValue('Kepala Kantor Wilayah Contoh')
        expect(screen.getByText('5 isian diisi dari berkas. Periksa kembali sebelum menyimpan.')).toBeInTheDocument()
        expect(mocks.keluar.create).not.toHaveBeenCalled()
    })
})
