import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ list: vi.fn(), unitKerjaOpsi: vi.fn() }))
vi.mock('@/services/rangkaian.service', () => ({ default: mocks, rangkaianService: mocks }))
import { BerkasRangkaianTab } from './BerkasRangkaianTab'

const R1 = '11111111-1111-4111-8111-111111111111'
const baris = { id: R1, kode: 'RS-2026-000001', status: 'diberkaskan', asal: 'surat_masuk', tahun: 2026, judul: 'Undangan rapat anggaran',
    unitPencatat: { id: 'sesditjen', nama: 'Sesditjen' }, unitPengolah: { id: 'dir_bppt', nama: 'Dit. BPPT' }, jumlahAnggota: 3,
    selesaiAt: '2026-09-01T00:00:00Z', diberkaskanAt: '2026-09-02T00:00:00Z', dapatDibuka: true }
const respons = (rows, aksi = []) => ({ success: true, data: rows, pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 }, meta: { aksiDiizinkan: aksi } })
const mount = () => render(<MemoryRouter><BerkasRangkaianTab /></MemoryRouter>)

beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue(respons([baris]))
    mocks.unitKerjaOpsi.mockResolvedValue([{ id: 'dir_bppt', name: 'Dit. BPPT' }])
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Tab Berkas Rangkaian', () => {
    it('memuat daftar tanpa data lama secara default dan menautkan kode ke Lacak', async () => {
        mount()
        expect(await screen.findByRole('link', { name: 'RS-2026-000001' })).toHaveAttribute('href', `/surat/lacak?rangkaian=${R1}`)
        expect(mocks.list).toHaveBeenCalledWith({ unitPengolahId: undefined, status: undefined, asal: undefined, page: 1, limit: 20 })
        expect(screen.getByLabelText('Asal')).toHaveValue('')
        expect(screen.getByRole('option', { name: 'Semua (tanpa data lama)' })).toBeInTheDocument()
        expect(screen.getByText('Dit. BPPT', { selector: 'td' })).toBeVisible()
        expect(screen.queryByRole('button', { name: 'Tutup massal data lama' })).toBeNull()
    })

    it('meneruskan filter status dan unit pengolah ke server', async () => {
        mount()
        await screen.findByRole('link', { name: 'RS-2026-000001' })
        await screen.findByRole('option', { name: 'Dit. BPPT' })
        fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'diberkaskan' } })
        await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'diberkaskan', page: 1 })))
        fireEvent.change(screen.getByLabelText('Unit pengolah'), { target: { value: 'dir_bppt' } })
        await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'diberkaskan', unitPengolahId: 'dir_bppt' })))
    })

    it('filter asal data lama meminta server secara eksplisit tanpa aksi mutasi (Tutup massal milik P5)', async () => {
        mount()
        await screen.findByRole('link', { name: 'RS-2026-000001' })
        fireEvent.change(screen.getByLabelText('Asal'), { target: { value: 'data_lama' } })
        await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ asal: 'data_lama' })))
        await screen.findByRole('link', { name: 'RS-2026-000001' })
        expect(screen.queryByRole('button', { name: /Tutup massal/ })).toBeNull()
    })

    it('kode rangkaian yang tidak dapat dibuka (dapatDibuka:false) tampil tanpa tautan', async () => {
        mocks.list.mockResolvedValue(respons([{ ...baris, dapatDibuka: false, judul: 'Rangkaian RS-2026-000001 (Dikecualikan)' }]))
        mount()
        expect(await screen.findByText('RS-2026-000001')).toBeVisible()
        expect(screen.queryByRole('link', { name: 'RS-2026-000001' })).toBeNull()
    })
})
