import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratKeluar from '@/pages/TambahSuratKeluar'
import { buildTindakLanjutState } from '@/lib/tindak-lanjut'

const fixtures = vi.hoisted(() => ({ create: vi.fn(), getNextNumber: vi.fn(), getById: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-bppt', role: 'admin_unit', unitKerjaId: 'dir_bppt' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }))
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: { create: fixtures.create, getNextNumber: fixtures.getNextNumber, getById: fixtures.getById } }))
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: { getById: vi.fn() } }))
// Pemilih popup diganti <select> native (pola surat-date-input.test.jsx); form aslinya tetap utuh.
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

let router
beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    fixtures.create.mockResolvedValue({ data: { id: 'sk-baru' } })
    fixtures.getNextNumber.mockResolvedValue({ nomorSurat: '001/X/09/2026' })
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function isiDanKirim(container) {
    fireEvent.change(document.getElementById('tanggal-surat-keluar'), { target: { value: '2026-09-24' } })
    fireEvent.change(document.getElementById('penerima-surat-keluar'), { target: { value: 'Direktur Jenderal' } })
    fireEvent.submit(container.querySelector('form'))
}

describe('mode TambahSuratKeluar', () => {
    it('inisiatif: badge, naskah dari query, payload asalNaskah tanpa induk', async () => {
        router = createMemoryRouter([
            { path: '/surat/keluar/inisiatif', element: <TambahSuratKeluar mode="inisiatif" /> },
            { path: '/surat/keluar', element: <h1>Daftar</h1> },
        ], { initialEntries: ['/surat/keluar/inisiatif?naskah=Keputusan'] })
        const view = render(<RouterProvider router={router} />)
        expect(screen.getByText('Inisiatif: memulai rangkaian baru')).toBeInTheDocument()
        expect(document.getElementById('naskah-dinas')).toHaveValue('Keputusan')
        fireEvent.change(document.getElementById('perihal-surat-keluar'), { target: { value: 'Penetapan tim terpadu' } })
        isiDanKirim(view.container)
        await waitFor(() => expect(fixtures.create).toHaveBeenCalled())
        const payload = fixtures.create.mock.calls[0][0]
        expect(payload).toMatchObject({ asalNaskah: 'inisiatif', naskahDinas: 'Keputusan', perihal: 'Penetapan tim terpadu' })
        expect(payload).not.toHaveProperty('tindakLanjut')
        expect(payload).not.toHaveProperty('balasanUntuk')
    })

    it('ND Penjelas dari detail Keputusan: chip terkunci, preset, payload relasi menjelaskan', async () => {
        const state = buildTindakLanjutState('surat_keluar', { id: 'sk-kep', nomorSurat: 'KEP-7/2026', perihal: 'Penetapan tim' }, 'buat_nd_penjelas')
        router = createMemoryRouter([
            { path: '/surat/keluar/tambah', element: <TambahSuratKeluar /> },
            { path: '/surat/keluar', element: <h1>Daftar</h1> },
        ], { initialEntries: [{ pathname: '/surat/keluar/tambah', state }] })
        const view = render(<RouterProvider router={router} />)
        expect(await screen.findByText('KEP-7/2026')).toBeInTheDocument()
        expect(screen.getByLabelText('Nomor Referensi terkunci')).toBeInTheDocument()
        expect(document.getElementById('naskah-dinas')).toHaveValue('Nota Dinas')
        expect(document.getElementById('perihal-surat-keluar')).toHaveValue('Penjelasan Keputusan Nomor KEP-7/2026')
        isiDanKirim(view.container)
        await waitFor(() => expect(fixtures.create).toHaveBeenCalled())
        expect(fixtures.create.mock.calls[0][0].tindakLanjut).toEqual({ jenis: 'surat_keluar', suratId: 'sk-kep', jenisRelasi: 'menjelaskan' })
    })

    it('create tanpa referensi, mode apa pun, mengirim asalNaskah: inisiatif', async () => {
        router = createMemoryRouter([
            { path: '/surat/keluar/tambah', element: <TambahSuratKeluar /> },
            { path: '/surat/keluar', element: <h1>Daftar</h1> },
        ], { initialEntries: ['/surat/keluar/tambah'] })
        const view = render(<RouterProvider router={router} />)
        fireEvent.change(document.getElementById('naskah-dinas'), { target: { value: 'Surat Dinas' } })
        fireEvent.change(document.getElementById('perihal-surat-keluar'), { target: { value: 'Surat rutin' } })
        isiDanKirim(view.container)
        await waitFor(() => expect(fixtures.create).toHaveBeenCalled())
        const payload = fixtures.create.mock.calls[0][0]
        expect(payload).toMatchObject({ asalNaskah: 'inisiatif' })
        expect(payload).not.toHaveProperty('tindakLanjut')
        expect(payload).not.toHaveProperty('balasanUntuk')
    })

    it('edit surat tanpa aksi edit pada aksiDiizinkan dialihkan ke halaman detail', async () => {
        fixtures.getById.mockResolvedValue({
            id: 'sk-1', unitKerjaId: 'dir_bppt', approvalStatus: 'draft', naskahDinas: 'Nota Dinas',
            perihal: 'Surat lama', tanggalSurat: '2026-09-01', aksiDiizinkan: ['view'],
        })
        router = createMemoryRouter([
            { path: '/edit/:id', element: <TambahSuratKeluar /> },
            { path: '/surat/keluar/:id', element: <h1>Detail</h1> },
        ], { initialEntries: ['/edit/sk-1'] })
        render(<RouterProvider router={router} />)
        await waitFor(() => expect(router.state.location.pathname).toBe('/surat/keluar/sk-1'))
        expect(screen.getByText('Detail')).toBeInTheDocument()
    })
})
