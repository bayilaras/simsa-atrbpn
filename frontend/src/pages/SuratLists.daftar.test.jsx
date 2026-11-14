import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import SuratMasuk from './SuratMasuk'
import SuratKeluar from './SuratKeluar'

const mocks = vi.hoisted(() => ({
    user: { id: 'sa', role: 'super_admin', unitKerjaId: null },
    toast: vi.fn(),
    masuk: { getAll: vi.fn(), getStats: vi.fn() },
    keluar: { getAll: vi.fn(), getStats: vi.fn() },
    units: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, canWrite: () => false }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { fileUploads: false } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/surat-masuk.service', () => ({ default: mocks.masuk, suratMasukService: mocks.masuk }))
vi.mock('@/services/surat-keluar.service', () => ({ default: mocks.keluar, suratKeluarService: mocks.keluar }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: mocks.units } }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))

const baris = {
    id: 'surat-1', unitKerjaId: 'sesditjen', unitKerjaNama: 'Sekretariat Direktorat Jenderal',
    nomorSurat: '001/UJI/2026', perihal: 'Perihal uji daftar', tanggalSurat: '2026-09-11',
    dari: 'Kanwil', kepada: 'Kantah', jenisSurat: 'Surat Dinas', naskahDinas: 'Surat Dinas', status: 'belum_dibalas',
}
const halaman = { success: true, data: [baris], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } }
const daftar = [
    { jenis: 'masuk', Component: SuratMasuk, filter: 'Jenis Surat', param: 'jenisSurat' },
    { jenis: 'keluar', Component: SuratKeluar, filter: 'Naskah Dinas', param: 'naskahDinas' },
]

beforeEach(() => {
    mocks.user = { id: 'sa', role: 'super_admin', unitKerjaId: null }
    for (const service of [mocks.masuk, mocks.keluar]) {
        service.getAll.mockReset().mockResolvedValue(halaman)
        service.getStats.mockReset().mockResolvedValue({ total: 1, belumDibalas: 1, sudahDibalas: 0, diarsipkan: 0 })
    }
    mocks.units.mockReset().mockResolvedValue([
        { id: 'sesditjen', name: 'Sekretariat Direktorat Jenderal', unitType: 'sesditjen' },
        { id: 'dir_bppt', name: 'Direktorat BPPT', unitType: 'direktorat' },
    ])
    mocks.toast.mockClear()
})
afterEach(cleanup)

const tampil = (Component) => render(<MemoryRouter><Component /></MemoryRouter>)

it('daftar surat masuk tidak lagi menampilkan label tanggal terima yang selalu kosong', async () => {
    tampil(SuratMasuk)
    await screen.findByText('Perihal uji daftar')
    expect(screen.queryByText(/\(Trm\)/)).not.toBeInTheDocument()
})

describe.each(daftar)('filter jenis pada daftar surat $jenis', ({ Component, jenis, filter, param }) => {
    it('menawarkan setiap jenis yang dapat disimpan formulir', async () => {
        tampil(Component)
        await screen.findByText('Perihal uji daftar')
        fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
        fireEvent.click(screen.getByRole('combobox', { name: filter }))
        for (const nama of ['Naskah Dinas Lainnya', 'Prosedur Tetap (Protap)', 'Tindak Lanjut Pengaduan',
            'Surat Keputusan Hak Wakaf', 'Permohonan Hak Milik', 'Pembatalan Hak']) {
            expect(await screen.findByRole('button', { name: nama })).toBeInTheDocument()
        }
        fireEvent.click(screen.getByRole('button', { name: 'Permohonan Hak Milik' }))
        await waitFor(() => expect(mocks[jenis].getAll).toHaveBeenLastCalledWith(expect.objectContaining({ [param]: 'Permohonan Hak Milik' })))
    })
})
