import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratKeluar from '@/pages/TambahSuratKeluar'

// No. Urut yang diketik saat mendaftarkan dan catatan pindah tahun saat mengubah.

const mocks = vi.hoisted(() => ({
    keluar: { create: vi.fn(), getNextNumber: vi.fn(), getById: vi.fn(), update: vi.fn() },
    lacak: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-bppt', role: 'admin_unit', unitKerjaId: 'dir_bppt' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }))
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: mocks.keluar }))
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: { getById: vi.fn() } }))
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
    id: 'sk-1', unitKerjaId: 'dir_bppt', approvalStatus: 'draft', naskahDinas: 'Nota Dinas', sifatSurat: 'biasa',
    nomorSurat: 'ND-4/2026', tanggalSurat: '2026-01-03', tahun: 2026, noUrut: 4, perihal: 'Surat lama', kepada: 'Direktur',
    klasifikasiKeamanan: 'biasa', aksiDiizinkan: ['edit'], updatedAt: '2026-01-03T02:00:00.456Z',
}
let router

beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    mocks.keluar.create.mockResolvedValue({ data: { id: 'sk-baru' } })
    mocks.keluar.update.mockResolvedValue({ id: 'sk-1' })
    mocks.keluar.getNextNumber.mockImplementation(async ({ noUrut }) => ({ nomorSurat: `${String(noUrut ?? 1).padStart(3, '0')}/Nota Dinas/09/2026` }))
    mocks.keluar.getById.mockResolvedValue(tersimpan)
    mocks.lacak.mockResolvedValue({ kelompok: [] })
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function tampil(entry, element = <TambahSuratKeluar />) {
    router = createMemoryRouter([
        { path: '/surat/keluar/tambah', element },
        { path: '/surat/keluar/inisiatif', element },
        { path: '/surat/keluar/edit/:id', element },
        { path: '/surat/keluar', element: <h1>Daftar</h1> },
    ], { initialEntries: [entry] })
    return render(<RouterProvider router={router} />)
}

function isiWajib() {
    fireEvent.change(document.getElementById('naskah-dinas'), { target: { value: 'Nota Dinas' } })
    fireEvent.change(document.getElementById('tanggal-surat-keluar'), { target: { value: '2026-09-24' } })
    fireEvent.change(document.getElementById('perihal-surat-keluar'), { target: { value: 'Undangan rapat' } })
    fireEvent.change(document.getElementById('penerima-surat-keluar'), { target: { value: 'Direktur Jenderal' } })
}

describe('No. Urut pada Tambah Surat Keluar dan surat inisiatif', () => {
    it.each([['/surat/keluar/tambah', <TambahSuratKeluar key="tambah" />], ['/surat/keluar/inisiatif', <TambahSuratKeluar key="inisiatif" mode="inisiatif" />]])(
        '%s mengirim No. Urut yang diketik dan pratinjau memakainya', async (entry, element) => {
            const view = tampil(entry, element)
            expect(screen.getByText('Kosongkan untuk nomor otomatis. Isi bila ingin melanjutkan nomor urut dari buku agenda kantor.')).toBeInTheDocument()
            isiWajib()
            fireEvent.change(screen.getByLabelText('No. Urut'), { target: { value: '120' } })
            expect(await screen.findByText('120/Nota Dinas/09/2026')).toBeInTheDocument()
            expect(mocks.keluar.getNextNumber).toHaveBeenLastCalledWith(expect.objectContaining({ noUrut: 120 }))
            fireEvent.submit(view.container.querySelector('form'))
            await waitFor(() => expect(mocks.keluar.create).toHaveBeenCalled())
            expect(mocks.keluar.create.mock.calls[0][0]).toMatchObject({ noUrut: 120, numberingMode: 'auto' })
        })

    it('menolak No. Urut di atas 999999 sebelum mengirim', async () => {
        const view = tampil('/surat/keluar/tambah')
        isiWajib()
        fireEvent.change(screen.getByLabelText('No. Urut'), { target: { value: '1000000' } })
        fireEvent.submit(view.container.querySelector('form'))
        expect(await screen.findByRole('alert')).toHaveTextContent('No. Urut harus berupa angka 1 sampai 999999')
        expect(mocks.keluar.create).not.toHaveBeenCalled()
    })
})

describe('Edit Surat Keluar: tahun surat', () => {
    it('tanpa isian No. Urut; catatan muncul bila tahun tanggal surat berubah', async () => {
        tampil('/surat/keluar/edit/sk-1')
        await screen.findByDisplayValue('Surat lama')
        expect(screen.queryByLabelText('No. Urut')).toBeNull()
        fireEvent.change(document.getElementById('tanggal-surat-keluar'), { target: { value: '2026-12-31' } })
        expect(screen.queryByText(/Tahun berubah/)).toBeNull()
        fireEvent.change(document.getElementById('tanggal-surat-keluar'), { target: { value: '2027-01-04' } })
        expect(screen.getByText('Tahun berubah. Surat akan mendapat nomor urut baru di tahun 2027.')).toBeInTheDocument()
    })
})
