import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratKeluar from '@/pages/TambahSuratKeluar'

// Edit Surat Keluar mengirim versi data yang dimuat; bila surat sudah diubah
// orang lain, pesan tampil dengan tombol Muat ulang.

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

const PESAN_VERSI = 'Data ini sudah diubah pengguna lain sejak Anda membukanya. Muat ulang halaman untuk melihat perubahan terbaru, lalu ulangi perubahan Anda.'
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
    mocks.keluar.update.mockResolvedValue({ id: 'sk-1' })
    mocks.keluar.getById.mockResolvedValue(tersimpan)
    mocks.lacak.mockResolvedValue({ kelompok: [] })
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Edit Surat Keluar: data yang sudah diubah orang lain', () => {
    it('mengirim versi yang dimuat; bila ditolak, Muat ulang memuat data terbaru', async () => {
        mocks.keluar.update.mockRejectedValueOnce(Object.assign(new Error(PESAN_VERSI), {
            status: 409, data: { success: false, error: 'DataSudahBerubahError', message: PESAN_VERSI, code: 'DATA_SUDAH_BERUBAH' },
        }))
        router = createMemoryRouter([
            { path: '/surat/keluar/edit/:id', element: <TambahSuratKeluar /> },
            { path: '/surat/keluar', element: <h1>Daftar</h1> },
        ], { initialEntries: ['/surat/keluar/edit/sk-1'] })
        const view = render(<RouterProvider router={router} />)
        await screen.findByDisplayValue('Surat lama')
        fireEvent.change(document.getElementById('perihal-surat-keluar'), { target: { value: 'Perihal versi saya' } })
        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(mocks.keluar.update).toHaveBeenCalledTimes(1))
        expect(mocks.keluar.update.mock.calls[0][1]).toMatchObject({ perihal: 'Perihal versi saya', expectedUpdatedAt: '2026-01-03T02:00:00.456Z' })

        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent(PESAN_VERSI)
        mocks.keluar.getById.mockResolvedValue({ ...tersimpan, perihal: 'Perihal dari orang lain', updatedAt: '2026-01-03T05:00:00.000Z' })
        fireEvent.click(within(alert).getByRole('button', { name: 'Muat ulang' }))
        expect(await screen.findByDisplayValue('Perihal dari orang lain')).toBeInTheDocument()
        expect(screen.queryByText(PESAN_VERSI)).toBeNull()

        fireEvent.submit(document.querySelector('form'))
        await waitFor(() => expect(mocks.keluar.update).toHaveBeenCalledTimes(2))
        expect(mocks.keluar.update.mock.calls[1][1]).toMatchObject({ expectedUpdatedAt: '2026-01-03T05:00:00.000Z' })
    })
})
