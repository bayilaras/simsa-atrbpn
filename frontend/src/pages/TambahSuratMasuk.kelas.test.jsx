import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratMasuk from './TambahSuratMasuk'
import { PESAN_KELAS_TERBATAS_PERAN, PESAN_SURAT_MASUK_PERLU_PERSETUJUAN } from '@/lib/kelas-keamanan'
import { memoryDrafts } from '@/lib/memory-drafts'
import { readSuratArchiveSelection } from '@/lib/surat-archive-selection'

// Sifat surat masuk memuat kelas keamanan; opsi yang pasti ditolak server
// (403 "Klasifikasi keamanan melebihi kewenangan pengguna") tidak ditawarkan.

const mocks = vi.hoisted(() => ({
    user: null,
    masuk: { create: vi.fn(), getNextNumber: vi.fn(), getById: vi.fn(), update: vi.fn() },
    dist: { getDistributableUnits: vi.fn(), getOpsi: vi.fn() },
    lacak: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }))
// Super Admin memilih unit lewat daftar unit dari server; di sini unitnya tetap.
vi.mock('@/hooks/use-required-unit-kerja-scope', () => ({
    useRequiredUnitKerjaScope: () => ({ isSuperAdmin: false, unitKerjaId: 'sesditjen', loading: false }),
}))
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: mocks.masuk }))
vi.mock('@/services/distribution.service', () => ({ default: mocks.dist, distributionService: mocks.dist }))
vi.mock('@/services/rangkaian.service', () => ({ rangkaianService: { lacak: mocks.lacak }, default: { lacak: mocks.lacak } }))
vi.mock('@/components/ui/searchable-select', () => ({
    SearchableSelect: ({ id, ariaLabel, value, onValueChange, options, ...rest }) => (
        <select id={id} aria-label={ariaLabel} aria-describedby={rest['aria-describedby']} value={value} onChange={event => onValueChange(event.target.value)}>
            <option value="">Pilih</option>
            {options.map(option => {
                const item = typeof option === 'string' ? { value: option, label: option } : option
                return <option key={item.value} value={item.value}>{item.label}</option>
            })}
        </select>
    ),
}))
vi.mock('@/components/ui/multi-select', () => ({
    MultiSelect: ({ id, ariaLabel, selected, onChange, options }) => (
        <select id={id} aria-label={ariaLabel} multiple value={selected}
            onChange={event => onChange(Array.from(event.target.selectedOptions, item => item.value))}>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
    ),
}))

const ADMIN_UNIT = { id: 'u-tu', role: 'admin_unit', unitKerjaId: 'sesditjen' }
const SUPER_ADMIN = { id: 'u-sa', role: 'super_admin', unitKerjaId: null }
let router

beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = ADMIN_UNIT
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    mocks.masuk.create.mockResolvedValue({ data: { id: 'sm-baru' } })
    mocks.masuk.update.mockResolvedValue({ data: { id: 'sm-1' } })
    mocks.masuk.getNextNumber.mockResolvedValue({ nomorSurat: '001/SM/2026' })
    mocks.dist.getDistributableUnits.mockResolvedValue([{ id: 'dir_bppt', name: 'Dit. BPPT', unitType: 'direktorat' }])
    mocks.dist.getOpsi.mockResolvedValue({ instruksi: [], jalurAksesTerkendali: false })
    mocks.lacak.mockResolvedValue({ kelompok: [] })
})
afterEach(() => { cleanup(); router?.dispose(); memoryDrafts.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const opsiSifat = () => [...document.getElementById('sifat-surat').options].map(option => option.value).filter(Boolean)

function tampil(path = '/surat/masuk/tambah') {
    router = createMemoryRouter([
        { path: '/surat/masuk/tambah', element: <TambahSuratMasuk /> },
        { path: '/surat/masuk/edit/:id', element: <TambahSuratMasuk /> },
        { path: '/surat/masuk', element: <h1>Daftar</h1> },
        { path: '/surat/masuk/:id', element: <h1>Detail</h1> },
    ], { initialEntries: [path] })
    return render(<RouterProvider router={router} />)
}

function isiWajib() {
    fireEvent.change(screen.getByRole('combobox', { name: 'Jenis surat' }), { target: { value: 'Nota Dinas' } })
    fireEvent.change(screen.getByLabelText(/Tanggal Surat/), { target: { value: '2026-09-23' } })
    fireEvent.change(screen.getByLabelText(/^Perihal/), { target: { value: 'Permohonan data' } })
    fireEvent.change(screen.getByLabelText(/^Dari \(Pengirim\)/), { target: { value: 'Pemda Sintetis' } })
    fireEvent.change(screen.getByLabelText(/^Kepada \(Penerima\)/), { target: { value: 'Direktur Jenderal' } })
}

describe('sifat surat masuk menurut peran', () => {
    it('Admin Unit Kerja ditawari Terbatas, tidak ditawari Rahasia dan Sangat Rahasia, dan melihat alasannya', async () => {
        tampil()
        await screen.findByRole('option', { name: 'Dit. BPPT' })
        expect(opsiSifat()).toEqual(['biasa', 'segera', 'sangat_segera', 'terbatas', 'undangan', 'penting'])
        expect(screen.getByText(PESAN_KELAS_TERBATAS_PERAN)).toBeInTheDocument()
        expect(document.getElementById('sifat-surat')).toHaveAttribute('aria-describedby', 'sifat-surat-bantuan')
    })

    it('Super Admin ditawari keempat kelas tanpa teks pembatasan', async () => {
        mocks.user = SUPER_ADMIN
        tampil()
        await screen.findByRole('option', { name: 'Dit. BPPT' })
        expect(opsiSifat()).toEqual(['biasa', 'segera', 'sangat_segera', 'terbatas', 'rahasia', 'sangat_rahasia', 'undangan', 'penting'])
        expect(screen.queryByText(PESAN_KELAS_TERBATAS_PERAN)).toBeNull()
        expect(screen.queryByText(PESAN_SURAT_MASUK_PERLU_PERSETUJUAN)).toBeNull()
        expect(document.getElementById('sifat-surat')).not.toHaveAttribute('aria-describedby')
    })

    it('surat terkendali dengan disposisi ditolak di klien selama jalur akses mati', async () => {
        mocks.user = SUPER_ADMIN
        const view = tampil()
        isiWajib()
        await screen.findByRole('option', { name: 'Dit. BPPT' })
        fireEvent.change(document.getElementById('sifat-surat'), { target: { value: 'rahasia' } })
        const listbox = screen.getByRole('listbox', { name: 'Penerima disposisi' })
        for (const option of listbox.options) option.selected = option.value === 'dir_bppt'
        fireEvent.change(listbox)
        fireEvent.submit(view.container.querySelector('form'))
        expect(await screen.findByRole('alert')).toHaveTextContent('Surat terkendali belum dapat didisposisikan')
        expect(mocks.masuk.create).not.toHaveBeenCalled()
    })

    it('draf berisi Rahasia milik Admin Unit Kerja diganti Biasa dan dikirim sebagai Biasa', async () => {
        memoryDrafts.set('simsa-draft-tambah-surat-masuk', {
            timestamp: Date.now(),
            data: {
                jenisSurat: 'Nota Dinas', sifatSurat: 'rahasia', nomorSurat: '', tanggalSurat: '2026-09-23',
                perihal: 'Draf lama', dari: 'Pemda Sintetis', kepada: 'Direktur Jenderal',
                klasifikasiKode: '', klasifikasiUraian: '', ...readSuratArchiveSelection(), keterangan: '',
                disposisi: [], disposisiPj: '', disposisiBatasWaktu: '', disposisiInstruksi: '', linkDokumen: '',
            },
        })
        vi.spyOn(window, 'confirm').mockReturnValue(true)
        const view = tampil()
        await waitFor(() => expect(screen.getByLabelText(/^Perihal/)).toHaveValue('Draf lama'))
        expect(document.getElementById('sifat-surat')).toHaveValue('biasa')
        expect(screen.getByText('Sifat Rahasia tidak dapat Anda pilih, sehingga diganti menjadi Biasa.')).toBeInTheDocument()
        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(mocks.masuk.create).toHaveBeenCalled())
        expect(mocks.masuk.create.mock.calls[0][0].sifatSurat).toBe('biasa')
    })

    it('mode ubah mempertahankan sifat Rahasia yang sudah tersimpan tanpa mengirimnya ulang', async () => {
        mocks.masuk.getById.mockResolvedValue({
            id: 'sm-1', unitKerjaId: 'sesditjen', jenisSurat: 'Nota Dinas', sifatSurat: 'rahasia',
            nomorSurat: 'B-1/2026', tanggalSurat: '2026-09-01', perihal: 'Perihal tersimpan',
            dari: 'A', kepada: 'B', disposisi: ['Ditjen'], aksiDiizinkan: ['edit'], rangkaian: null,
        })
        const view = tampil('/surat/masuk/edit/sm-1')
        await screen.findByDisplayValue('Perihal tersimpan')
        expect(opsiSifat()).toEqual(['biasa', 'segera', 'sangat_segera', 'terbatas', 'rahasia', 'undangan', 'penting'])
        expect(document.getElementById('sifat-surat')).toHaveValue('rahasia')
        expect(screen.queryByText(/sehingga diganti/)).toBeNull()
        // Pesan umum "hanya Super Admin" bertentangan dengan rekod yang tetap dapat disimpan.
        expect(screen.queryByText(PESAN_KELAS_TERBATAS_PERAN)).toBeNull()
        expect(document.getElementById('sifat-surat-bantuan')).toHaveTextContent(
            'Sifat Rahasia yang sudah tersimpan boleh dipertahankan. Bila diganti lalu disimpan, sifat ini hanya dapat dipilih kembali oleh Super Admin.',
        )
        expect(document.getElementById('sifat-surat')).toHaveAttribute('aria-describedby', 'sifat-surat-bantuan')
        fireEvent.change(screen.getByLabelText(/^Dari \(Pengirim\)/), { target: { value: 'Kanwil Baru' } })
        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(mocks.masuk.update).toHaveBeenCalled())
        expect(mocks.masuk.update.mock.calls[0][1]).toMatchObject({ dari: 'Kanwil Baru' })
        expect(mocks.masuk.update.mock.calls[0][1]).not.toHaveProperty('sifatSurat')
    })

    it('sifat hasil impor berhuruf kapital tampil terpilih dan tidak dikirim ulang', async () => {
        mocks.masuk.getById.mockResolvedValue({
            id: 'sm-2', unitKerjaId: 'sesditjen', jenisSurat: 'Nota Dinas', sifatSurat: 'Rahasia',
            nomorSurat: 'B-2/2026', tanggalSurat: '2026-09-01', perihal: 'Hasil impor',
            dari: 'A', kepada: 'B', disposisi: ['Ditjen'], aksiDiizinkan: ['edit'], rangkaian: null,
        })
        const view = tampil('/surat/masuk/edit/sm-2')
        await screen.findByDisplayValue('Hasil impor')
        expect(document.getElementById('sifat-surat')).toHaveValue('rahasia')
        fireEvent.change(screen.getByLabelText(/^Dari \(Pengirim\)/), { target: { value: 'Kanwil Baru' } })
        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(mocks.masuk.update).toHaveBeenCalled())
        expect(mocks.masuk.update.mock.calls[0][1]).not.toHaveProperty('sifatSurat')
    })

    it.each([
        ['Admin Unit Kerja', ADMIN_UNIT, 'terbatas'],
        ['Super Admin', SUPER_ADMIN, 'terbatas'],
        ['Super Admin', SUPER_ADMIN, 'sangat_rahasia'],
    ])('%s mencatat surat baru bersifat %s', async (_peran, user, sifat) => {
        mocks.user = user
        vi.spyOn(window, 'confirm').mockReturnValue(true)
        const view = tampil()
        isiWajib()
        await screen.findByRole('option', { name: 'Dit. BPPT' })
        fireEvent.change(document.getElementById('sifat-surat'), { target: { value: sifat } })
        expect(document.getElementById('sifat-surat')).toHaveValue(sifat)
        // Pencatat pun memerlukan persetujuan akses untuk membuka surat terkendali.
        expect(document.getElementById('sifat-surat-bantuan')).toHaveTextContent(PESAN_SURAT_MASUK_PERLU_PERSETUJUAN)
        expect(document.getElementById('sifat-surat')).toHaveAttribute('aria-describedby', 'sifat-surat-bantuan')
        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(mocks.masuk.create).toHaveBeenCalled())
        expect(mocks.masuk.create.mock.calls[0][0].sifatSurat).toBe(sifat)
    })

    it.each([
        ['Biasa', 'terbatas', true],
        ['Rahasia', 'terbatas', true],
        ['Terbatas', 'terbatas', false],
        ['Terbatas', 'biasa', false],
    ])('mode ubah: sifat tersimpan %s diganti %s menampilkan catatan persetujuan akses: %s', async (tersimpan, baru, tampilCatatan) => {
        mocks.user = SUPER_ADMIN
        mocks.masuk.getById.mockResolvedValue({
            id: 'sm-4', unitKerjaId: 'sesditjen', jenisSurat: 'Nota Dinas', sifatSurat: tersimpan,
            nomorSurat: 'B-4/2026', tanggalSurat: '2026-09-01', perihal: 'Ganti sifat',
            dari: 'A', kepada: 'B', disposisi: ['Ditjen'], aksiDiizinkan: ['edit'], rangkaian: null,
        })
        tampil('/surat/masuk/edit/sm-4')
        await screen.findByDisplayValue('Ganti sifat')
        expect(screen.queryByText(PESAN_SURAT_MASUK_PERLU_PERSETUJUAN)).toBeNull()
        fireEvent.change(document.getElementById('sifat-surat'), { target: { value: baru } })
        if (tampilCatatan) {
            expect(screen.getByText(PESAN_SURAT_MASUK_PERLU_PERSETUJUAN)).toBeInTheDocument()
        } else {
            expect(screen.queryByText(PESAN_SURAT_MASUK_PERLU_PERSETUJUAN)).toBeNull()
        }
    })

    it.each([
        ['Terbatas', 'terbatas', ['biasa', 'segera', 'sangat_segera', 'terbatas', 'undangan', 'penting'], PESAN_KELAS_TERBATAS_PERAN],
        ['Sangat  Rahasia', 'sangat_rahasia', ['biasa', 'segera', 'sangat_segera', 'terbatas', 'sangat_rahasia', 'undangan', 'penting'],
            'Sifat Sangat Rahasia yang sudah tersimpan boleh dipertahankan. Bila diganti lalu disimpan, sifat ini hanya dapat dipilih kembali oleh Super Admin.'],
    ])('mode ubah Admin Unit Kerja memetakan sifat impor %j ke opsi %s', async (tersimpan, opsi, daftarOpsi, bantuan) => {
        mocks.masuk.getById.mockResolvedValue({
            id: 'sm-3', unitKerjaId: 'sesditjen', jenisSurat: 'Nota Dinas', sifatSurat: tersimpan,
            nomorSurat: 'B-3/2026', tanggalSurat: '2026-09-01', perihal: 'Kelas hasil impor',
            dari: 'A', kepada: 'B', disposisi: ['Ditjen'], aksiDiizinkan: ['edit'], rangkaian: null,
        })
        const view = tampil('/surat/masuk/edit/sm-3')
        await screen.findByDisplayValue('Kelas hasil impor')
        expect(opsiSifat()).toEqual(daftarOpsi)
        expect(document.getElementById('sifat-surat')).toHaveValue(opsi)
        expect(document.getElementById('sifat-surat-bantuan')).toHaveTextContent(bantuan)
        fireEvent.change(screen.getByLabelText(/^Dari \(Pengirim\)/), { target: { value: 'Kanwil Baru' } })
        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(mocks.masuk.update).toHaveBeenCalled())
        expect(mocks.masuk.update.mock.calls[0][1]).not.toHaveProperty('sifatSurat')
    })
})
