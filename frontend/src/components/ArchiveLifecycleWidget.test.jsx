import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchiveLifecycleWidget } from './ArchiveLifecycleWidget'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/services/api', () => ({ api: { get: mocks.get } }))

const PESAN_GAGAL = 'Status retensi belum dapat dimuat. Periksa koneksi Anda lalu coba lagi.'
const statusUnit = total => ({
    success: true,
    data: {
        summary: { total, expired: 1, willExpire: 0, alreadyInactive: 0, willBeInactive: 0 },
        expired: [{ id: 'arsip-1', nomorBerkas: 'B-001/2020', uraianBerkas: 'Berkas lama', hasilAkhir: 'Musnah' }],
        willExpire: [], alreadyInactive: [], willBeInactive: [],
    },
})

beforeEach(() => {
    mocks.get.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('ArchiveLifecycleWidget', () => {
    it('meminta Super Admin memilih unit tanpa memanggil server saat Semua Unit Kerja dipilih', () => {
        render(<ArchiveLifecycleWidget perluPilihUnit />)
        expect(screen.getByText('Status Retensi Arsip')).toBeInTheDocument()
        expect(screen.getByText('Pilih unit kerja untuk melihat status retensi.')).toBeInTheDocument()
        expect(mocks.get).not.toHaveBeenCalled()
    })

    it('memuat status untuk unit yang dipilih dan memuat ulang saat unit berganti', async () => {
        mocks.get.mockResolvedValueOnce(statusUnit(7)).mockResolvedValueOnce(statusUnit(12))
        const view = render(<ArchiveLifecycleWidget unitKerjaId="unit-a" />)
        expect(await screen.findByText('Total 7 arsip tercatat')).toBeInTheDocument()
        expect(mocks.get).toHaveBeenCalledWith('/api/arsip-picker/lifecycle', { unitKerjaId: 'unit-a' })

        view.rerender(<ArchiveLifecycleWidget unitKerjaId="unit-b" />)
        expect(await screen.findByText('Total 12 arsip tercatat')).toBeInTheDocument()
        expect(mocks.get).toHaveBeenLastCalledWith('/api/arsip-picker/lifecycle', { unitKerjaId: 'unit-b' })
    })

    it('mengabaikan jawaban terlambat dari unit sebelumnya', async () => {
        let jawabUnitA
        mocks.get
            .mockReturnValueOnce(new Promise(resolve => { jawabUnitA = resolve }))
            .mockResolvedValueOnce(statusUnit(12))
        const view = render(<ArchiveLifecycleWidget unitKerjaId="unit-a" />)
        view.rerender(<ArchiveLifecycleWidget unitKerjaId="unit-b" />)
        expect(await screen.findByText('Total 12 arsip tercatat')).toBeInTheDocument()
        await act(async () => { jawabUnitA(statusUnit(7)) })
        expect(screen.getByText('Total 12 arsip tercatat')).toBeInTheDocument()
        expect(screen.queryByText('Total 7 arsip tercatat')).not.toBeInTheDocument()
    })

    it('menampilkan pesan galat berbahasa Indonesia lalu dapat mencoba lagi', async () => {
        mocks.get.mockRejectedValueOnce(new Error('Failed to fetch lifecycle notifications')).mockResolvedValueOnce(statusUnit(3))
        render(<ArchiveLifecycleWidget unitKerjaId="unit-a" />)
        expect(await screen.findByRole('alert')).toHaveTextContent(PESAN_GAGAL)
        expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
        expect(await screen.findByText('Total 3 arsip tercatat')).toBeInTheDocument()
        await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2))
    })

    it('jawaban tanpa data dianggap gagal, bukan area kosong', async () => {
        mocks.get.mockResolvedValueOnce({ success: false, error: 'unitKerjaId is required' })
        render(<ArchiveLifecycleWidget unitKerjaId="unit-a" />)
        expect(await screen.findByRole('alert')).toHaveTextContent(PESAN_GAGAL)
    })
})
