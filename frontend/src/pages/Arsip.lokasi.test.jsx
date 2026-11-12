import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Arsip from './Arsip'

const mocks = vi.hoisted(() => ({
    user: { id: 'reader-1', role: 'staff', unitKerjaId: 'unit-1' },
    getAll: vi.fn(),
    getStats: vi.fn(),
    getById: vi.fn(),
}))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, canWrite: () => false }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/services/arsip.service', () => ({ arsipService: { getAll: mocks.getAll, getStats: mocks.getStats } }))
vi.mock('@/services/storage-location.service', () => ({ default: { getById: mocks.getById } }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ArchiveLifecycleWidget', () => ({ ArchiveLifecycleWidget: () => null }))

const LOKASI = '70000000-0000-4000-8000-000000000004'
const tampilkan = entry => render(<MemoryRouter initialEntries={[entry]}><Routes>
    <Route path="/arsip/:tab" element={<Arsip />} />
</Routes></MemoryRouter>)

describe('daftar arsip tersaring per lokasi simpan', () => {
    beforeEach(() => {
        mocks.getAll.mockReset().mockResolvedValue({ data: [{ id: 'archive-1', uraianBerkas: 'Berkas di boks' }], pagination: { total: 1 } })
        mocks.getStats.mockReset().mockResolvedValue({ total: 1, arsipMasuk: 1, arsipKeluar: 0 })
        mocks.getById.mockReset().mockResolvedValue({ id: LOKASI, code: 'G1-B1', name: 'Boks Satu' })
    })
    afterEach(cleanup)

    it('meneruskan lokasi dari tautan ke permintaan daftar dan menampilkan chip yang dapat dihapus', async () => {
        tampilkan(`/arsip/masuk?lokasi=${LOKASI}`)
        expect(await screen.findByText('Berkas di boks')).toBeInTheDocument()
        expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ jenisArsip: 'masuk', storageLocationId: LOKASI, unitKerjaId: 'unit-1' }))
        expect(mocks.getById).toHaveBeenCalledWith(LOKASI, 'unit-1')

        const chip = await screen.findByRole('button', { name: 'Hapus filter lokasi simpan' })
        await waitFor(() => expect(chip).toHaveTextContent('Lokasi simpan: Boks Satu (G1-B1)'))

        fireEvent.click(chip)
        await waitFor(() => expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ storageLocationId: undefined })))
        expect(screen.queryByRole('button', { name: 'Hapus filter lokasi simpan' })).not.toBeInTheDocument()
    })

    it('nilai lokasi yang bukan id diabaikan', async () => {
        tampilkan('/arsip/masuk?lokasi=G1-B1')
        await screen.findByText('Berkas di boks')
        expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ storageLocationId: undefined }))
        expect(mocks.getById).not.toHaveBeenCalled()
    })

    it('chip memakai teks umum bila nama lokasi tidak dapat dimuat', async () => {
        mocks.getById.mockRejectedValue(new Error('tidak tersedia'))
        tampilkan(`/arsip/masuk?lokasi=${LOKASI}`)
        expect(await screen.findByRole('button', { name: 'Hapus filter lokasi simpan' })).toHaveTextContent('Lokasi simpan: lokasi terpilih')
    })
})
