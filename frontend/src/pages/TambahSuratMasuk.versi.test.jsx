import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratMasuk from './TambahSuratMasuk'
import { clearOfflineStorage } from '@/lib/offline-storage'

// Edit Surat Masuk mengirim versi data yang dimuat; bila surat sudah diubah
// orang lain, pesan tampil dengan tombol Muat ulang.

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

const PESAN_VERSI = 'Data ini sudah diubah pengguna lain sejak Anda membukanya. Muat ulang halaman untuk melihat perubahan terbaru, lalu ulangi perubahan Anda.'
const galatVersi = () => Object.assign(new Error(PESAN_VERSI), {
    status: 409, data: { success: false, error: 'DataSudahBerubahError', message: PESAN_VERSI, code: 'DATA_SUDAH_BERUBAH' },
})
const tersimpan = {
    id: 'sm-1', unitKerjaId: 'sesditjen', jenisSurat: 'Nota Dinas', sifatSurat: 'biasa', nomorSurat: 'SM-1/2026',
    tanggalSurat: '2026-09-11', tahun: 2026, noUrut: 14, perihal: 'Perihal tersimpan', dari: 'Kanwil A', kepada: 'Direktur',
    disposisi: ['Ditjen'], linkDokumen: null, filePath: null, aksiDiizinkan: ['edit'], updatedAt: '2026-09-11T08:00:00.123Z',
}
let router

beforeEach(async () => {
    vi.clearAllMocks()
    await clearOfflineStorage()
    Element.prototype.scrollIntoView = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    mocks.masuk.update.mockResolvedValue({ id: 'sm-1' })
    mocks.masuk.getById.mockResolvedValue(tersimpan)
    mocks.dist.getDistributableUnits.mockResolvedValue([])
    mocks.dist.getOpsi.mockResolvedValue({ instruksi: [], jalurAksesTerkendali: false })
    mocks.lacak.mockResolvedValue({ kelompok: [] })
})
afterEach(() => { cleanup(); router?.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function tampilEdit() {
    router = createMemoryRouter([
        { path: '/surat/masuk/edit/:id', element: <TambahSuratMasuk /> },
        { path: '/surat/masuk', element: <h1>Daftar</h1> },
    ], { initialEntries: ['/surat/masuk/edit/sm-1'] })
    const view = render(<RouterProvider router={router} />)
    await screen.findByDisplayValue('Perihal tersimpan')
    return view
}

describe('Edit Surat Masuk: data yang sudah diubah orang lain', () => {
    it('mengirim versi yang dimuat; bila ditolak, Muat ulang memuat data terbaru dan versinya', async () => {
        mocks.masuk.update.mockRejectedValueOnce(galatVersi())
        const view = await tampilEdit()
        fireEvent.change(screen.getByLabelText(/^Perihal/), { target: { value: 'Perihal versi saya' } })
        fireEvent.submit(view.container.querySelector('form'))
        await waitFor(() => expect(mocks.masuk.update).toHaveBeenCalledTimes(1))
        expect(mocks.masuk.update.mock.calls[0][1]).toMatchObject({ perihal: 'Perihal versi saya', expectedUpdatedAt: '2026-09-11T08:00:00.123Z' })

        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent(PESAN_VERSI)
        mocks.masuk.getById.mockResolvedValue({ ...tersimpan, perihal: 'Perihal dari orang lain', updatedAt: '2026-09-11T09:15:00.000Z' })
        fireEvent.click(within(alert).getByRole('button', { name: 'Muat ulang' }))
        expect(await screen.findByDisplayValue('Perihal dari orang lain')).toBeInTheDocument()
        expect(screen.queryByText(PESAN_VERSI)).toBeNull()

        fireEvent.submit(document.querySelector('form'))
        await waitFor(() => expect(mocks.masuk.update).toHaveBeenCalledTimes(2))
        expect(mocks.masuk.update.mock.calls[1][1]).toMatchObject({ expectedUpdatedAt: '2026-09-11T09:15:00.000Z' })
    })

    it('galat lain tidak menawarkan Muat ulang', async () => {
        mocks.masuk.update.mockRejectedValueOnce(Object.assign(new Error('Surat ini bagian dari berkas rangkaian yang sudah diberkaskan.'), {
            status: 409, data: { error: 'ConflictError', message: 'Surat ini bagian dari berkas rangkaian yang sudah diberkaskan.', code: 'CONFLICT' },
        }))
        const view = await tampilEdit()
        fireEvent.change(screen.getByLabelText(/^Perihal/), { target: { value: 'Perihal versi saya' } })
        fireEvent.submit(view.container.querySelector('form'))
        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent('Surat ini bagian dari berkas rangkaian yang sudah diberkaskan.')
        expect(within(alert).queryByRole('button', { name: 'Muat ulang' })).toBeNull()
    })
})
