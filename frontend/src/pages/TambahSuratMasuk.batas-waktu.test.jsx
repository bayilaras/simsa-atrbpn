import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratMasuk from './TambahSuratMasuk'
import { clearOfflineStorage } from '@/lib/offline-storage'

// Batas waktu disposisi saat registrasi: tanggal yang sudah lewat ditolak dengan pesan aplikasi.

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
vi.mock('@/components/ui/multi-select', () => ({
    MultiSelect: ({ id, ariaLabel, options, selected, onChange }) => (
        <select id={id} aria-label={ariaLabel} multiple value={selected} onChange={event => onChange(Array.from(event.target.selectedOptions, option => option.value))}>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
    ),
}))

let router

beforeEach(async () => {
    vi.clearAllMocks()
    await clearOfflineStorage()
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    mocks.masuk.create.mockResolvedValue({ data: { id: 'sm-baru' } })
    mocks.masuk.getNextNumber.mockImplementation(async ({ noUrut }) => ({ nextNumber: 9, nomorSurat: `${String(noUrut ?? 9).padStart(3, '0')}/SM/2026` }))
    mocks.dist.getDistributableUnits.mockResolvedValue([{ id: 'dir_bppt', name: 'Direktorat BPPT' }])
    mocks.dist.getOpsi.mockResolvedValue({ instruksi: [], jalurAksesTerkendali: false })
    mocks.lacak.mockResolvedValue({ kelompok: [] })
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function tampilDenganDisposisi() {
    router = createMemoryRouter([
        { path: '/surat/masuk/tambah', element: <TambahSuratMasuk /> },
        { path: '/surat/masuk', element: <h1>Daftar</h1> },
    ], { initialEntries: ['/surat/masuk/tambah'] })
    const view = render(<RouterProvider router={router} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Jenis surat' }), { target: { value: 'Nota Dinas' } })
    fireEvent.change(screen.getByLabelText(/Tanggal Surat/), { target: { value: '2026-09-23' } })
    fireEvent.change(screen.getByLabelText(/^Perihal/), { target: { value: 'Permohonan data' } })
    fireEvent.change(screen.getByLabelText(/^Dari \(Pengirim\)/), { target: { value: 'Pemda Sintetis' } })
    fireEvent.change(screen.getByLabelText(/^Kepada \(Penerima\)/), { target: { value: 'Direktur Jenderal' } })
    const unit = await screen.findByRole('option', { name: 'Direktorat BPPT' })
    unit.selected = true
    fireEvent.change(screen.getByRole('listbox', { name: 'Penerima disposisi' }))
    return view
}

describe('Batas waktu disposisi pada Tambah Surat Masuk', () => {
    // Peramban menahan formulir lewat atribut min sebelum submit; pesan aplikasi yang harus tampil, bukan balon peramban.
    it('mengganti balon peramban dengan pesan aplikasi', async () => {
        await tampilDenganDisposisi()
        const isian = await screen.findByLabelText('Batas waktu')
        fireEvent.change(isian, { target: { value: '2000-01-01' } })
        expect(fireEvent.invalid(isian)).toBe(false)
        expect(await screen.findByRole('alert')).toHaveTextContent('Batas waktu tidak boleh sebelum hari ini')
        expect(isian).toHaveAccessibleDescription('Batas waktu tidak boleh sebelum hari ini')

        fireEvent.change(isian, { target: { value: '2999-01-01' } })
        expect(document.getElementById('batas-waktu-registrasi-error')).toBeNull()
        expect(mocks.masuk.create).not.toHaveBeenCalled()
    })

    it('menolak batas waktu yang sudah lewat sebelum mengirim', async () => {
        const view = await tampilDenganDisposisi()
        fireEvent.change(await screen.findByLabelText('Batas waktu'), { target: { value: '2000-01-01' } })
        fireEvent.submit(view.container.querySelector('form'))
        expect(await screen.findByRole('alert')).toHaveTextContent('Batas waktu tidak boleh sebelum hari ini')
        expect(document.getElementById('batas-waktu-registrasi-error')).toHaveTextContent('Batas waktu tidak boleh sebelum hari ini')
        expect(mocks.masuk.create).not.toHaveBeenCalled()
    })
})
