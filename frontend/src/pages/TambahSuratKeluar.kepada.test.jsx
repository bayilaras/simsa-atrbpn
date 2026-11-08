import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratKeluar from '@/pages/TambahSuratKeluar'

// Server mewajibkan Kepada; formulir menandainya wajib dan menampilkan pesan
// per isian dari galat validasi server, bukan "Validation failed".

const mocks = vi.hoisted(() => ({
    keluar: { create: vi.fn(), getNextNumber: vi.fn(), getById: vi.fn(), update: vi.fn() },
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-bppt', role: 'admin_unit', unitKerjaId: 'dir_bppt' } }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }))
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

let router

beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    mocks.keluar.create.mockResolvedValue({ data: { id: 'sk-baru' } })
    mocks.keluar.update.mockResolvedValue({ data: { id: 'sk-1' } })
    mocks.keluar.getNextNumber.mockResolvedValue({ nomorSurat: '001/X/09/2026' })
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function tampil(entry) {
    router = createMemoryRouter([
        { path: '/surat/keluar/tambah', element: <TambahSuratKeluar /> },
        { path: '/surat/keluar/edit/:id', element: <TambahSuratKeluar /> },
        { path: '/surat/keluar', element: <h1>Daftar</h1> },
    ], { initialEntries: [entry] })
    return render(<RouterProvider router={router} />)
}

function isiTanpaKepada() {
    fireEvent.change(document.getElementById('naskah-dinas'), { target: { value: 'Nota Dinas' } })
    fireEvent.change(document.getElementById('tanggal-surat-keluar'), { target: { value: '2026-09-24' } })
    fireEvent.change(document.getElementById('perihal-surat-keluar'), { target: { value: 'Penyampaian data' } })
}

describe('isian Kepada surat keluar', () => {
    it('ditandai wajib dan kosongnya ditolak sebelum mengirim ke server', async () => {
        const view = tampil('/surat/keluar/tambah')
        const kepada = document.getElementById('penerima-surat-keluar')
        expect(kepada).toBeRequired()
        expect(document.querySelector('label[for="penerima-surat-keluar"]')).toHaveTextContent('Kepada *')
        isiTanpaKepada()
        fireEvent.submit(view.container.querySelector('form'))
        expect(await screen.findAllByText('Kepada wajib diisi')).toHaveLength(2)
        expect(kepada).toHaveAttribute('aria-invalid', 'true')
        expect(mocks.keluar.create).not.toHaveBeenCalled()
    })

    it('mode ubah juga menolak Kepada yang kosong', async () => {
        mocks.keluar.getById.mockResolvedValue({
            id: 'sk-1', unitKerjaId: 'dir_bppt', naskahDinas: 'Nota Dinas', sifatSurat: 'biasa',
            nomorSurat: 'ND-1/2026', tanggalSurat: '2026-09-01', perihal: 'Perihal tersimpan', kepada: null,
            klasifikasiKeamanan: 'biasa', approvalStatus: 'draft', aksiDiizinkan: ['edit'],
        })
        const view = tampil('/surat/keluar/edit/sk-1')
        await screen.findByDisplayValue('Perihal tersimpan')
        fireEvent.submit(view.container.querySelector('form'))
        expect(await screen.findAllByText('Kepada wajib diisi')).toHaveLength(2)
        expect(mocks.keluar.update).not.toHaveBeenCalled()
    })

    it('galat validasi server menampilkan pesan per isian, bukan "Validation failed"', async () => {
        const galat = Object.assign(new Error('Validation failed'), {
            status: 400,
            details: [{ field: 'kepada', message: 'Penerima tidak valid' }],
        })
        mocks.keluar.create.mockRejectedValue(galat)
        const view = tampil('/surat/keluar/tambah')
        isiTanpaKepada()
        fireEvent.change(document.getElementById('penerima-surat-keluar'), { target: { value: 'Direktur Jenderal' } })
        fireEvent.submit(view.container.querySelector('form'))
        expect(await screen.findAllByText('Penerima tidak valid')).toHaveLength(2)
        expect(screen.queryByText('Validation failed')).toBeNull()
        expect(document.getElementById('penerima-surat-keluar')).toHaveAttribute('aria-invalid', 'true')
    })
})
