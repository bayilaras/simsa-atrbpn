import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratMasuk from './TambahSuratMasuk'
import TambahSuratKeluar from './TambahSuratKeluar'
import { bacaDrafIsian, hapusSemuaDrafIsian, kunciDrafIsian } from '@/lib/draf-isian'

// Isian formulir surat yang belum disimpan bertahan di sessionStorage tab ini
// saat sesi berakhir atau halaman dimuat ulang (formulir dilepas lalu dibuka
// lagi), ditawarkan kembali hanya kepada pengguna yang sama, dan dihapus saat
// tersimpan, Batal, atau dibuang. Isi berkas tidak pernah disimpan.

const mocks = vi.hoisted(() => ({
    user: null,
    capabilities: { fileUploads: false },
    masuk: { create: vi.fn(), update: vi.fn(), getById: vi.fn(), getNextNumber: vi.fn(), getBelumDibalas: vi.fn() },
    keluar: { create: vi.fn(), update: vi.fn(), getById: vi.fn(), getNextNumber: vi.fn() },
    dist: { getDistributableUnits: vi.fn(), getOpsi: vi.fn() },
    lacak: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: mocks.capabilities }) }))
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: mocks.masuk }))
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: mocks.keluar }))
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

const PENGGUNA_A = { id: 'u-a', role: 'admin_unit', unitKerjaId: 'unit-a' }
const PENGGUNA_B = { id: 'u-b', role: 'admin_unit', unitKerjaId: 'unit-a' }
const KUNCI_MASUK_A = kunciDrafIsian({ userId: 'u-a', formulir: 'surat-masuk' })
const TERSIMPAN = 'Isian tersimpan sementara di tab ini'
const suratKeluar = {
    id: 'sk-1', unitKerjaId: 'unit-a', approvalStatus: 'draft', naskahDinas: 'Nota Dinas', sifatSurat: 'biasa',
    nomorSurat: 'ND-1/2026', tanggalSurat: '2026-09-11', tahun: 2026, perihal: 'Perihal tersimpan', kepada: 'Direktur',
    klasifikasiKeamanan: 'biasa', aksiDiizinkan: ['edit'], updatedAt: '2026-09-11T01:00:00.000Z',
}
let routers = []

beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = PENGGUNA_A
    mocks.capabilities = { fileUploads: false }
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    mocks.masuk.getNextNumber.mockResolvedValue({ nomorSurat: '001/SM/2026' })
    mocks.masuk.getBelumDibalas.mockResolvedValue({ data: [] })
    mocks.keluar.getNextNumber.mockResolvedValue({ nomorSurat: '001/ND/2026' })
    mocks.keluar.getById.mockResolvedValue(suratKeluar)
    mocks.dist.getDistributableUnits.mockResolvedValue([])
    mocks.dist.getOpsi.mockResolvedValue({ instruksi: [], jalurAksesTerkendali: false })
    mocks.lacak.mockResolvedValue({ kelompok: [] })
})
afterEach(() => {
    cleanup()
    routers.forEach(router => router.dispose())
    routers = []
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

function tampil(entry) {
    const router = createMemoryRouter([
        { path: '/surat/masuk/tambah', element: <TambahSuratMasuk /> },
        { path: '/surat/keluar/edit/:id', element: <TambahSuratKeluar /> },
        { path: '/surat/masuk', element: <h1>Daftar surat masuk</h1> },
        { path: '/surat/keluar', element: <h1>Daftar surat keluar</h1> },
    ], { initialEntries: [entry] })
    routers.push(router)
    return render(<RouterProvider router={router} />)
}

async function ketikSuratMasuk() {
    fireEvent.change(screen.getByLabelText(/^Perihal/), { target: { value: 'Permohonan data pertanahan' } })
    fireEvent.change(screen.getByLabelText(/^Dari \(Pengirim\)/), { target: { value: 'Pemda Sintetis' } })
    expect(await screen.findByText(TERSIMPAN, {}, { timeout: 3000 })).toBeInTheDocument()
}

describe('draf isian Tambah Surat Masuk', () => {
    it('bertahan setelah formulir dibuka ulang dan dapat dipulihkan', async () => {
        const pertama = tampil('/surat/masuk/tambah')
        await ketikSuratMasuk()
        expect(sessionStorage.getItem(KUNCI_MASUK_A)).toContain('Permohonan data pertanahan')
        expect(localStorage.length).toBe(0)
        pertama.unmount()

        tampil('/surat/masuk/tambah')
        const dialog = await screen.findByRole('alertdialog', { name: 'Pulihkan isian yang belum disimpan?' })
        expect(dialog).toHaveTextContent('Formulir ini memiliki isian yang belum disimpan')
        fireEvent.click(within(dialog).getByRole('button', { name: 'Pulihkan isian' }))
        await waitFor(() => expect(screen.getByLabelText(/^Perihal/)).toHaveValue('Permohonan data pertanahan'))
        expect(screen.getByLabelText(/^Dari \(Pengirim\)/)).toHaveValue('Pemda Sintetis')
        expect(screen.getByText('Isian dipulihkan')).toBeInTheDocument()
    })

    it('tidak ditawarkan kepada pengguna lain di tab yang sama', async () => {
        const pertama = tampil('/surat/masuk/tambah')
        await ketikSuratMasuk()
        pertama.unmount()

        mocks.user = PENGGUNA_B
        tampil('/surat/masuk/tambah')
        expect(screen.queryByRole('alertdialog')).toBeNull()
        expect(screen.getByLabelText(/^Perihal/)).toHaveValue('')
    })

    it('Buang isian menghapus draf dan membiarkan formulir kosong', async () => {
        const pertama = tampil('/surat/masuk/tambah')
        await ketikSuratMasuk()
        pertama.unmount()

        tampil('/surat/masuk/tambah')
        fireEvent.click(await screen.findByRole('button', { name: 'Buang isian' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        expect(screen.getByLabelText(/^Perihal/)).toHaveValue('')
        expect(bacaDrafIsian(KUNCI_MASUK_A)).toBeNull()
    })

    it('tidak bertahan setelah pengguna keluar', async () => {
        const pertama = tampil('/surat/masuk/tambah')
        await ketikSuratMasuk()
        hapusSemuaDrafIsian()
        pertama.unmount()

        tampil('/surat/masuk/tambah')
        expect(screen.queryByRole('alertdialog')).toBeNull()
        expect(bacaDrafIsian(KUNCI_MASUK_A)).toBeNull()
    })

    it('dihapus setelah surat tersimpan', async () => {
        mocks.masuk.create.mockResolvedValue({ data: { id: 'sm-baru' } })
        const view = tampil('/surat/masuk/tambah')
        fireEvent.change(screen.getByRole('combobox', { name: 'Jenis surat' }), { target: { value: 'Nota Dinas' } })
        fireEvent.change(screen.getByLabelText(/Tanggal Surat/), { target: { value: '2026-09-23' } })
        fireEvent.change(screen.getByLabelText(/^Kepada \(Penerima\)/), { target: { value: 'Direktur Jenderal' } })
        await ketikSuratMasuk()
        fireEvent.submit(view.container.querySelector('form'))
        fireEvent.click(await screen.findByRole('button', { name: 'Simpan tanpa disposisi' }))
        await screen.findByText(/telah disimpan ke sistem/)
        expect(bacaDrafIsian(KUNCI_MASUK_A)).toBeNull()
        expect(screen.queryByText(TERSIMPAN)).toBeNull()
    })

    it('Batal lalu Tinggalkan halaman menghapus draf', async () => {
        tampil('/surat/masuk/tambah')
        await ketikSuratMasuk()
        fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
        const dialog = await screen.findByRole('alertdialog', { name: 'Tinggalkan halaman ini?' })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Tinggalkan halaman' }))
        expect(await screen.findByRole('heading', { name: 'Daftar surat masuk' })).toBeInTheDocument()
        expect(bacaDrafIsian(KUNCI_MASUK_A)).toBeNull()
    })

    it('hanya menyimpan nama berkas, bukan isinya, dan meminta berkas dipilih ulang', async () => {
        mocks.capabilities = { fileUploads: true }
        const pertama = tampil('/surat/masuk/tambah')
        const isi = 'ISI-BERKAS-RAHASIA'
        fireEvent.change(pertama.container.querySelector('input[type="file"]'), {
            target: { files: [new File([isi], 'pindai.pdf', { type: 'application/pdf' })] },
        })
        await ketikSuratMasuk()
        const tersimpan = sessionStorage.getItem(KUNCI_MASUK_A)
        expect(tersimpan).toContain('pindai.pdf')
        expect(tersimpan).not.toContain(isi)
        pertama.unmount()

        tampil('/surat/masuk/tambah')
        expect(await screen.findByRole('alertdialog', { name: 'Pulihkan isian yang belum disimpan?' }))
            .toHaveTextContent('Berkas pindai.pdf tidak ikut tersimpan; pilih ulang berkasnya setelah memulihkan isian.')
    })
})

describe('kemajuan unggah berkas', () => {
    it('menampilkan persen unggah saat surat masuk disimpan bersama PDF', async () => {
        mocks.capabilities = { fileUploads: true }
        mocks.masuk.create.mockImplementation((_data, _file, { onProgress }) => {
            onProgress({ loaded: 4, total: 10, percentage: 40 })
            return new Promise(() => {})
        })
        const view = tampil('/surat/masuk/tambah')
        fireEvent.change(screen.getByRole('combobox', { name: 'Jenis surat' }), { target: { value: 'Nota Dinas' } })
        fireEvent.change(screen.getByLabelText(/Tanggal Surat/), { target: { value: '2026-09-23' } })
        fireEvent.change(screen.getByLabelText(/^Kepada \(Penerima\)/), { target: { value: 'Direktur Jenderal' } })
        fireEvent.change(view.container.querySelector('input[type="file"]'), {
            target: { files: [new File(['pdf'], 'pindai.pdf', { type: 'application/pdf' })] },
        })
        await ketikSuratMasuk()
        fireEvent.submit(view.container.querySelector('form'))
        fireEvent.click(await screen.findByRole('button', { name: 'Simpan tanpa disposisi' }))
        expect(await screen.findByText('Mengunggah berkas: 40%')).toBeInTheDocument()
        expect(screen.getByRole('progressbar', { name: 'Kemajuan unggah berkas' })).toHaveAttribute('aria-valuenow', '40')
        expect(screen.getByRole('button', { name: /Mengunggah 40%/ })).toBeDisabled()
    })
})

describe('draf isian Edit Surat Keluar', () => {
    it('dipulihkan setelah data surat dimuat dan tetap memakai versi saat isian mulai diubah', async () => {
        mocks.keluar.update.mockResolvedValue(suratKeluar)
        const pertama = tampil('/surat/keluar/edit/sk-1')
        await screen.findByDisplayValue('Perihal tersimpan')
        fireEvent.change(screen.getByLabelText(/^Perihal/), { target: { value: 'Perihal yang diperbaiki' } })
        expect(await screen.findByText(TERSIMPAN, {}, { timeout: 3000 })).toBeInTheDocument()
        pertama.unmount()

        // Surat diubah orang lain sementara sesi pengguna berakhir.
        mocks.keluar.getById.mockResolvedValue({ ...suratKeluar, perihal: 'Diubah orang lain', updatedAt: '2026-09-12T05:00:00.000Z' })
        const kedua = tampil('/surat/keluar/edit/sk-1')
        fireEvent.click(await screen.findByRole('button', { name: 'Pulihkan isian' }))
        await waitFor(() => expect(screen.getByLabelText(/^Perihal/)).toHaveValue('Perihal yang diperbaiki'))
        fireEvent.submit(kedua.container.querySelector('form'))
        await waitFor(() => expect(mocks.keluar.update).toHaveBeenCalledTimes(1))
        expect(mocks.keluar.update.mock.calls[0][1]).toMatchObject({
            perihal: 'Perihal yang diperbaiki',
            expectedUpdatedAt: '2026-09-11T01:00:00.000Z',
        })
    })
})
