import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import AutentikasiIndex from './Autentikasi/Index'
import LayananArsipIndex from './LayananArsip/Index'
import PenyusutanArsip from './PenyusutanArsip'

const mocks = vi.hoisted(() => ({
    autentikasi: vi.fn(), layanan: vi.fn(), batches: vi.fn(), candidates: vi.fn(),
}))
vi.mock('@/services/autentikasi.service', () => ({ autentikasiService: { getAll: mocks.autentikasi, getPdf: vi.fn() } }))
vi.mock('@/services/layanan-arsip.service', () => ({ layananArsipService: { getAll: mocks.layanan } }))
vi.mock('@/services/penyusutan.service', () => ({ penyusutanService: { findAll: mocks.batches, getCandidates: mocks.candidates } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'arsiparis', role: 'admin_unit', unitKerjaId: 'unit-a' } }) }))
vi.mock('@/hooks/use-required-unit-kerja-scope', () => ({ useRequiredUnitKerjaScope: () => ({ unitKerjaId: 'unit-a', loading: false }) }))
vi.mock('@/components/RequiredUnitKerjaScope', () => ({ RequiredUnitKerjaScope: () => null }))

// Search is debounced by 300 ms; leave room for that on a busy test worker.
const SETTLED = { timeout: 3000 }
const page = (rows, pageNumber, total) => ({ data: rows, pagination: { page: pageNumber, limit: 20, total, totalPages: Math.ceil(total / 20) } })
function show(element) { return render(<MemoryRouter>{element}</MemoryRouter>) }
async function nextPage(label) {
    const nav = screen.getByRole('navigation', { name: `Halaman ${label}` })
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'Berikutnya' })).toBeEnabled())
    fireEvent.click(within(nav).getByRole('button', { name: 'Berikutnya' }))
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

describe('list pages keep server pagination', () => {
    it('autentikasi pages and searches on the server, keeping only the newest search', async () => {
        const row = nomor => ({ id: nomor, nomorBeritaAcara: nomor, tanggalAutentikasi: '2026-09-01', kegiatan: 'Alih media', jumlahArsip: 1 })
        mocks.autentikasi.mockImplementation(async ({ page: pageNumber }) => page([row(`BA-${pageNumber}`)], pageNumber, 21))
        show(<AutentikasiIndex />)
        expect(await screen.findByText('BA-1')).toBeInTheDocument()
        expect(mocks.autentikasi).toHaveBeenLastCalledWith({ search: undefined, page: 1, limit: 20 })
        await nextPage('autentikasi')
        expect(await screen.findByText('BA-2')).toBeInTheDocument()
        expect(mocks.autentikasi).toHaveBeenLastCalledWith({ search: undefined, page: 2, limit: 20 })

        let resolveOld
        mocks.autentikasi.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
        for (const value of ['B', 'BA', 'BA-0']) fireEvent.change(screen.getByPlaceholderText('Cari nomor berita acara...'), { target: { value } })
        await waitFor(() => expect(mocks.autentikasi).toHaveBeenCalledTimes(3), SETTLED)
        expect(mocks.autentikasi).toHaveBeenLastCalledWith({ search: 'BA-0', page: 1, limit: 20 })
        fireEvent.change(screen.getByPlaceholderText('Cari nomor berita acara...'), { target: { value: 'BA-9' } })
        expect(await screen.findByText('BA-1', {}, SETTLED)).toBeInTheDocument()
        await act(async () => resolveOld(page([row('BA-lama')], 1, 1)))
        expect(screen.queryByText('BA-lama')).not.toBeInTheDocument()
    })

    it('layanan arsip reaches the next server page and says the search covers this page only', async () => {
        const row = id => ({ id, createdAt: '2026-09-01T01:00:00Z', jenisLayanan: 'legalisasi', status: 'diajukan',
            arsip: { nomorBerkas: id, uraianBerkas: 'Uraian' }, pemohon: { name: 'Pemohon' } })
        mocks.layanan.mockImplementation(async ({ page: pageNumber }) => page([row(`LB-${pageNumber}`)], pageNumber, 21))
        show(<LayananArsipIndex />)
        expect(await screen.findByText('LB-1')).toBeInTheDocument()
        expect(mocks.layanan).toHaveBeenLastCalledWith({ page: 1, limit: 20 })
        expect(screen.getByPlaceholderText('Cari nomor berkas, uraian, pemohon...'))
            .toHaveAccessibleDescription('Pencarian hanya menyaring halaman yang sedang ditampilkan.')
        await nextPage('layanan arsip')
        expect(await screen.findByText('LB-2')).toBeInTheDocument()
        expect(mocks.layanan).toHaveBeenLastCalledWith({ page: 2, limit: 20 })
    })

    it('penyusutan batches reach the next server page', async () => {
        mocks.candidates.mockResolvedValue([])
        mocks.batches.mockImplementation(async ({ page: pageNumber }) => page([
            { id: `batch-${pageNumber}-abcdef`, nomorBA: `BA-PNY-${pageNumber}`, status: 'draft', totalBerkas: 1 },
        ], pageNumber, 21))
        show(<PenyusutanArsip />)
        expect(await screen.findByText('BA-PNY-1')).toBeInTheDocument()
        expect(mocks.batches).toHaveBeenLastCalledWith({ unitKerjaId: 'unit-a', jenisPenyusutan: 'pemindahan', page: 1, limit: 20 })
        await nextPage('riwayat usulan')
        expect(await screen.findByText('BA-PNY-2')).toBeInTheDocument()
        expect(mocks.batches).toHaveBeenLastCalledWith({ unitKerjaId: 'unit-a', jenisPenyusutan: 'pemindahan', page: 2, limit: 20 })
    })
})
