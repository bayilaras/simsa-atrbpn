import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import Arsip from './Arsip'

const mocks = vi.hoisted(() => ({
    user: { id: 'staff-a', role: 'staff', unitKerjaId: 'unit-a' },
    getAll: vi.fn(), getStats: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, canWrite: () => false }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/services/arsip.service', () => ({ arsipService: { getAll: mocks.getAll, getStats: mocks.getStats } }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ArchiveLifecycleWidget', () => ({ ArchiveLifecycleWidget: () => null }))
vi.mock('@/components/archives/SavedArchiveFilters', () => ({ SavedArchiveFilters: () => null }))
vi.mock('@/components/archives/ArchivePreviewPanel', () => ({ ArchivePreviewPanel: ({ archiveId, onClose }) => {
    const navigate = useNavigate()
    return <aside aria-label="Pratinjau"><p>{archiveId}</p><button onClick={onClose}>Tutup pratinjau</button><button onClick={() => navigate(`/arsip/detail/${archiveId}`)}>Buka detail</button></aside>
} }))

function Location() {
    const location = useLocation()
    return <output data-testid="location">{location.pathname}{location.search}</output>
}
function Detail() {
    const navigate = useNavigate()
    return <button onClick={() => navigate(-1)}>Kembali ke arsip</button>
}
function mount(entry = '/arsip/masuk') {
    return render(<MemoryRouter initialEntries={[entry]}><Location /><Routes>
        <Route path="/arsip/:tab" element={<Arsip />} />
        <Route path="/arsip/detail/:id" element={<Detail />} />
    </Routes></MemoryRouter>)
}
const result = (title = 'Berkas rapat', total = 65) => ({ data: [{ id: title, uraianBerkas: title }], pagination: { total } })

describe('archive list navigation', () => {
    beforeEach(() => {
        mocks.user = { id: 'staff-a', role: 'staff', unitKerjaId: 'unit-a' }
        mocks.getAll.mockReset().mockResolvedValue(result())
        mocks.getStats.mockReset().mockResolvedValue({ total: 65, arsipMasuk: 65, arsipKeluar: 0 })
    })
    afterEach(cleanup)

    it.each(['masuk', 'keluar'])('displays the canonical classification label in the %s archive list', async kind => {
        mocks.getAll.mockResolvedValue({ data: [{ id: 'archive-rules', uraianBerkas: 'Arsip beraturan', kodeKlasifikasi: 'BP.02.02', klasifikasiArsip: 'Bimbingan Teknis dan Supervisi' }], pagination: { total: 1 } })
        mount(`/arsip/${kind}`)
        expect(await screen.findByText('BP.02.02')).toBeInTheDocument()
        expect(screen.getByText('Bimbingan Teknis dan Supervisi')).toBeVisible()
    })

    it('restores search, year and pagination after opening a detail, ignoring an unauthorized URL unit', async () => {
        mount('/arsip/masuk?q=rapat&tahun=2025&unit=unit-b&page=2&limit=25')
        const title = await screen.findByRole('button', { name: 'Berkas rapat' })
        expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'rapat', tahun: 2025, unitKerjaId: 'unit-a', page: 2, limit: 25 }))
        expect(screen.getByLabelText('Cari arsip')).toHaveValue('rapat')
        fireEvent.click(title)
        fireEvent.click(screen.getByRole('button', { name: 'Buka detail' }))
        fireEvent.click(screen.getByRole('button', { name: 'Kembali ke arsip' }))
        await screen.findByRole('button', { name: 'Berkas rapat' })
        expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'rapat', tahun: 2025, page: 2, limit: 25 }))
        expect(screen.getByText('65 arsip · Halaman 2 dari 3')).toBeInTheDocument()
    })

    it('resets to the first page for page-size changes and preserves the search', async () => {
        mount('/arsip/masuk?q=rapat&page=3')
        await screen.findByRole('button', { name: 'Berkas rapat' })
        fireEvent.change(screen.getByLabelText('Baris'), { target: { value: '50' } })
        await waitFor(() => expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'rapat', page: 1, limit: 50 })))
        expect(screen.getByTestId('location')).toHaveTextContent('/arsip/masuk?q=rapat&limit=50')
    })

    it('recovers an out-of-range bookmarked page and hides obsolete preview when search changes', async () => {
        mocks.getAll.mockResolvedValue(result('Arsip terbaru', 1))
        mount('/arsip/masuk?page=20')
        await waitFor(() => expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 })), { timeout: 10000 })
        const title = await screen.findByText('Arsip terbaru')
        expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }))
        expect(screen.getByTestId('location').textContent).toBe('/arsip/masuk')
        fireEvent.click(title)
        expect(screen.getByRole('complementary', { name: 'Pratinjau' })).toBeInTheDocument()
        fireEvent.change(screen.getByLabelText('Cari arsip'), { target: { value: 'tanah' } })
        expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
        await waitFor(() => expect(mocks.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'tanah', page: 1 })))
    })

    it('rejects late search responses and restores keyboard focus when preview closes', async () => {
        let resolveOld
        mocks.getAll.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
            .mockResolvedValue(result('Hasil baru', 1))
        mount('/arsip/masuk?q=lama')
        await waitFor(() => expect(mocks.getAll).toHaveBeenCalledOnce())
        fireEvent.change(screen.getByLabelText('Cari arsip'), { target: { value: 'baru' } })
        const title = await screen.findByRole('button', { name: 'Hasil baru' })
        await act(async () => resolveOld(result('Hasil lama')))
        expect(screen.queryByText('Hasil lama')).not.toBeInTheDocument()
        fireEvent.click(title)
        fireEvent.click(screen.getByRole('button', { name: 'Tutup pratinjau' }))
        expect(title).toHaveFocus()
    })
})
