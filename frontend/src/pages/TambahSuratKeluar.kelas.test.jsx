import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratKeluar from '@/pages/TambahSuratKeluar'
import { buildTindakLanjutState } from '@/lib/tindak-lanjut'
import { PESAN_KELAS_TERBATAS_PERAN } from '@/lib/kelas-keamanan'

// Klasifikasi keamanan surat keluar: kelas di atas plafon peran pasti ditolak
// server (403), jadi tidak ditawarkan kecuali sudah tersimpan pada rekod.

const mocks = vi.hoisted(() => ({
    user: null,
    keluar: { create: vi.fn(), getNextNumber: vi.fn(), getById: vi.fn(), update: vi.fn() },
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }))
// Super Admin memilih unit lewat daftar unit dari server; di sini unitnya tetap.
vi.mock('@/hooks/use-required-unit-kerja-scope', () => ({
    useRequiredUnitKerjaScope: () => ({ isSuperAdmin: false, unitKerjaId: 'dir_bppt', loading: false }),
}))
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: mocks.keluar }))
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: { getById: vi.fn() } }))
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

const ADMIN_UNIT = { id: 'u-bppt', role: 'admin_unit', unitKerjaId: 'dir_bppt' }
let router

beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = ADMIN_UNIT
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    mocks.keluar.create.mockResolvedValue({ data: { id: 'sk-baru' } })
    mocks.keluar.update.mockResolvedValue({ data: { id: 'sk-1' } })
    mocks.keluar.getNextNumber.mockResolvedValue({ nomorSurat: '001/X/09/2026' })
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

// Radix Select di dalam form merender <select> native tersembunyi berisi opsi
// yang dirender; formulir ini hanya punya satu Select Radix.
const opsiKelas = () => [...document.querySelector('select[aria-hidden="true"]').options]
    .map(option => option.value).filter(Boolean)

function tampil(entry) {
    router = createMemoryRouter([
        { path: '/surat/keluar/tambah', element: <TambahSuratKeluar /> },
        { path: '/surat/keluar/edit/:id', element: <TambahSuratKeluar /> },
        { path: '/surat/keluar', element: <h1>Daftar</h1> },
    ], { initialEntries: [entry] })
    return render(<RouterProvider router={router} />)
}

function isiDanKirim(container) {
    fireEvent.change(document.getElementById('naskah-dinas'), { target: { value: 'Nota Dinas' } })
    fireEvent.change(document.getElementById('tanggal-surat-keluar'), { target: { value: '2026-09-24' } })
    fireEvent.change(document.getElementById('perihal-surat-keluar'), { target: { value: 'Penyampaian data' } })
    fireEvent.change(document.getElementById('penerima-surat-keluar'), { target: { value: 'Direktur Jenderal' } })
    fireEvent.submit(container.querySelector('form'))
}

describe('klasifikasi keamanan surat keluar menurut peran', () => {
    it('Admin Unit Kerja hanya ditawari Biasa dan Terbatas beserta alasannya', async () => {
        const view = tampil('/surat/keluar/tambah')
        expect(opsiKelas()).toEqual(['biasa', 'terbatas'])
        expect(screen.getByText(PESAN_KELAS_TERBATAS_PERAN)).toBeInTheDocument()
        isiDanKirim(view.container)
        await waitFor(() => expect(mocks.keluar.create).toHaveBeenCalled())
        expect(mocks.keluar.create.mock.calls[0][0].klasifikasiKeamanan).toBe('biasa')
    })

    it('Super Admin ditawari keempat kelas tanpa teks pembatasan', () => {
        mocks.user = { id: 'u-sa', role: 'super_admin', unitKerjaId: null }
        tampil('/surat/keluar/tambah')
        expect(opsiKelas()).toEqual(['biasa', 'terbatas', 'rahasia', 'sangat_rahasia'])
        expect(screen.queryByText(PESAN_KELAS_TERBATAS_PERAN)).toBeNull()
    })

    it('isian awal Rahasia dari navigasi diganti Biasa dan dikirim sebagai Biasa', async () => {
        const state = buildTindakLanjutState('surat_keluar', { id: 'sk-kep', nomorSurat: 'KEP-7/2026', perihal: 'Penetapan tim' }, 'buat_nd_penjelas')
        state.preset = { ...state.preset, klasifikasiKeamanan: 'rahasia' }
        const view = tampil({ pathname: '/surat/keluar/tambah', state })
        expect(await screen.findByText('Klasifikasi Rahasia tidak dapat Anda pilih, sehingga diganti menjadi Biasa / Terbuka.')).toBeInTheDocument()
        expect(opsiKelas()).toEqual(['biasa', 'terbatas'])
        isiDanKirim(view.container)
        await waitFor(() => expect(mocks.keluar.create).toHaveBeenCalled())
        expect(mocks.keluar.create.mock.calls[0][0].klasifikasiKeamanan).toBe('biasa')
    })

    it('mode ubah mempertahankan kelas Rahasia yang sudah tersimpan', async () => {
        mocks.keluar.getById.mockResolvedValue({
            id: 'sk-1', unitKerjaId: 'dir_bppt', naskahDinas: 'Nota Dinas', sifatSurat: 'biasa',
            nomorSurat: 'ND-1/2026', tanggalSurat: '2026-09-01', perihal: 'Perihal tersimpan', kepada: 'Dirjen',
            klasifikasiKeamanan: 'rahasia', approvalStatus: 'draft', aksiDiizinkan: ['edit'],
        })
        const view = tampil('/surat/keluar/edit/sk-1')
        await screen.findByDisplayValue('Perihal tersimpan')
        expect(opsiKelas()).toEqual(['biasa', 'terbatas', 'rahasia'])
        expect(screen.queryByText(/sehingga diganti/)).toBeNull()
        // Pesan umum "hanya Super Admin" bertentangan dengan rekod yang tetap dapat disimpan.
        expect(screen.queryByText(PESAN_KELAS_TERBATAS_PERAN)).toBeNull()
        expect(screen.getByText(
            'Kelas Rahasia yang sudah tersimpan boleh dipertahankan. Bila diganti lalu disimpan, kelas ini hanya dapat dipilih kembali oleh Super Admin.',
        )).toBeInTheDocument()
        fireEvent.change(document.getElementById('penerima-surat-keluar'), { target: { value: 'Direktur Jenderal' } })
        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(mocks.keluar.update).toHaveBeenCalled())
        expect(mocks.keluar.update.mock.calls[0][1]).toMatchObject({ kepada: 'Direktur Jenderal', klasifikasiKeamanan: 'rahasia' })
    })
})
