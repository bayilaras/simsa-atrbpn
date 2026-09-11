import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Arsip from './Arsip'

const mocks = vi.hoisted(() => ({
    user: { id: 'reader-1', role: 'staff', unitKerjaId: 'unit-1' },
    getAll: vi.fn(),
    getStats: vi.fn(),
}))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, canWrite: () => false }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/services/arsip.service', () => ({ arsipService: { getAll: mocks.getAll, getStats: mocks.getStats } }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ArchiveLifecycleWidget', () => ({ ArchiveLifecycleWidget: () => null }))

describe('archive refresh', () => {
    beforeEach(() => {
        mocks.getAll.mockReset().mockResolvedValue({ data: [], pagination: { total: 0 } })
        mocks.getStats.mockReset().mockResolvedValue({ total: 0, arsipMasuk: 0, arsipKeluar: 0 })
    })
    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    it('shows newly available archives and updated totals when refreshed from the first page', async () => {
        render(<MemoryRouter initialEntries={['/arsip/keluar']}><Routes>
            <Route path="/arsip/:tab" element={<Arsip />} />
        </Routes></MemoryRouter>)
        await screen.findByText('Belum ada data arsip keluar')

        mocks.getAll.mockResolvedValue({
            data: [{ id: 'archive-1', uraianBerkas: 'Berkas yang baru diarsipkan' }],
            pagination: { total: 1 },
        })
        mocks.getStats.mockResolvedValue({ total: 1, arsipMasuk: 0, arsipKeluar: 1 })
        fireEvent.click(screen.getByRole('button', { name: 'Perbarui' }))

        expect(await screen.findByText('Berkas yang baru diarsipkan')).toBeInTheDocument()
        await waitFor(() => expect(mocks.getStats).toHaveBeenCalledTimes(2))
        const totalCard = screen.getByText('Total Arsip').parentElement
        expect(totalCard).toHaveTextContent('1')
    })

    it('shows a load failure instead of an empty archive list and recovers on retry', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        mocks.getAll.mockRejectedValueOnce(new Error('Layanan arsip sedang tidak tersedia'))
        render(<MemoryRouter initialEntries={['/arsip/keluar']}><Routes>
            <Route path="/arsip/:tab" element={<Arsip />} />
        </Routes></MemoryRouter>)

        const error = await screen.findByRole('alert')
        expect(error).toHaveTextContent('Gagal memuat daftar arsip')
        expect(screen.queryByText('Belum ada data arsip keluar')).not.toBeInTheDocument()

        mocks.getAll.mockResolvedValue({
            data: [{ id: 'archive-1', uraianBerkas: 'Arsip setelah koneksi pulih' }],
            pagination: { total: 1 },
        })
        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
        expect(await screen.findByText('Arsip setelah koneksi pulih')).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('keeps refreshed totals when an earlier statistics request completes later', async () => {
        let resolveInitialStats
        mocks.getStats.mockImplementationOnce(() => new Promise(resolve => { resolveInitialStats = resolve }))
            .mockResolvedValue({ total: 9, arsipMasuk: 4, arsipKeluar: 5 })
        render(<MemoryRouter initialEntries={['/arsip/keluar']}><Routes>
            <Route path="/arsip/:tab" element={<Arsip />} />
        </Routes></MemoryRouter>)
        await screen.findByText('Belum ada data arsip keluar')
        fireEvent.click(screen.getByRole('button', { name: 'Perbarui' }))
        const totalCard = screen.getByText('Total Arsip').parentElement
        await waitFor(() => expect(totalCard).toHaveTextContent('9'))

        await act(async () => resolveInitialStats({ total: 0, arsipMasuk: 0, arsipKeluar: 0 }))
        expect(totalCard).toHaveTextContent('9')
    })
})
