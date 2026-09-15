import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ArchivePreviewPanel } from './ArchivePreviewPanel'

const mocks = vi.hoisted(() => ({
    files: true, getArchive: vi.fn(), getMasuk: vi.fn(), getKeluar: vi.fn(), fetchPrivateFile: vi.fn(),
}))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: mocks.files } }) }))
vi.mock('@/services/arsip.service', () => ({ arsipService: { getById: mocks.getArchive } }))
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: { getById: mocks.getMasuk } }))
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: { getById: mocks.getKeluar } }))
vi.mock('@/services/private-file.service', () => ({ fetchPrivateFile: mocks.fetchPrivateFile }))
vi.mock('@/components/FileScanStatus', () => ({ FileScanStatus: () => null }))

const archive = {
    id: 'archive-1', jenisArsip: 'masuk', sourceSuratId: 'surat-1', uraianBerkas: 'Berkas penetapan hak',
    nomorBerkas: 'B-001', kodeKlasifikasi: 'HT.01.01', klasifikasiArsip: 'Penetapan Hak', jraKode: 'S.III.01', jraUraian: 'Retensi berkas penetapan hak', tahun: 2026, lokasiFc: 'FC-2',
    lokasiLaci: 'Laci-3', lokasiFolder: 'Folder-8', klasifikasiKeamanan: 'rahasia',
    disposalStatus: 'proposed_pindah', retensiAktif: '2 tahun', legalHold: true,
}
const fileRecord = { id: 'surat-1', filePath: 'private/source-document.pdf', fileOriginalName: 'dokumen.pdf' }
const renderPanel = (props = {}) => render(<MemoryRouter><ArchivePreviewPanel archiveId="archive-1" onClose={vi.fn()} {...props} /></MemoryRouter>)
const deferred = () => {
    let resolve
    const promise = new Promise(done => { resolve = done })
    return { promise, resolve }
}

describe('ArchivePreviewPanel', () => {
    let createObjectURL
    let revokeObjectURL
    beforeEach(() => {
        mocks.files = true
        mocks.getArchive.mockReset().mockResolvedValue(archive)
        mocks.getMasuk.mockReset().mockResolvedValue({ id: 'surat-1' })
        mocks.getKeluar.mockReset().mockResolvedValue({ id: 'surat-1' })
        mocks.fetchPrivateFile.mockReset().mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }))
        createObjectURL = vi.fn().mockReturnValue('blob:archive-preview')
        revokeObjectURL = vi.fn()
        vi.stubGlobal('URL', class extends URL {
            static createObjectURL = createObjectURL
            static revokeObjectURL = revokeObjectURL
        })
    })
    afterEach(() => {
        cleanup()
        vi.unstubAllGlobals()
    })

    it('focuses its heading and offers keyboard and button dismissal while loading', () => {
        mocks.getArchive.mockReturnValue(new Promise(() => {}))
        const onClose = vi.fn()
        renderPanel({ onClose })
        const heading = screen.getByRole('heading', { name: 'Pratinjau arsip' })
        expect(heading).toHaveFocus()
        expect(screen.getByRole('status', { name: 'Memuat pratinjau arsip' })).toBeInTheDocument()
        fireEvent.keyDown(heading, { key: 'Escape' })
        fireEvent.click(screen.getByRole('button', { name: 'Tutup pratinjau arsip' }))
        expect(onClose).toHaveBeenCalledTimes(2)
    })

    it('keeps metadata available without requesting source records when file storage is disabled', async () => {
        mocks.files = false
        renderPanel()
        expect(await screen.findByText('Berkas penetapan hak')).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: 'Identitas arsip' })).toBeInTheDocument()
        expect(screen.getByText('FC-2')).toBeInTheDocument()
        expect(screen.getByText('HT.01.01')).toBeInTheDocument()
        expect(screen.getByText('Penetapan Hak')).toBeInTheDocument()
        expect(screen.getByText('S.III.01')).toBeInTheDocument()
        expect(screen.getByText('Retensi berkas penetapan hak')).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: 'Retensi dan penyusutan' })).toBeInTheDocument()
        expect(screen.getByText('Usulan pemindahan')).toBeInTheDocument()
        expect(screen.getByRole('heading', { name: 'Keamanan dan akses' })).toBeInTheDocument()
        expect(screen.getByText('rahasia')).toBeInTheDocument()
        expect(screen.getByText(/Penyimpanan berkas digital belum diaktifkan/)).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Buka detail lengkap' })).toHaveAttribute('href', '/arsip/detail/archive-1')
        expect(mocks.getMasuk).not.toHaveBeenCalled()
        expect(mocks.getKeluar).not.toHaveBeenCalled()
        expect(mocks.fetchPrivateFile).not.toHaveBeenCalled()
    })

    it('recovers from an archive load error on retry', async () => {
        mocks.getArchive.mockRejectedValueOnce(new Error('Connection interrupted'))
        renderPanel()
        expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat pratinjau arsip')
        expect(mocks.getMasuk).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
        expect(await screen.findByText('Berkas penetapan hak')).toBeInTheDocument()
        expect(mocks.getArchive).toHaveBeenCalledTimes(2)
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('ignores an older archive response when selection changes', async () => {
        const first = deferred()
        mocks.getArchive.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ...archive, id: 'archive-2', sourceSuratId: null, uraianBerkas: 'Arsip terbaru' })
        const view = renderPanel()
        view.rerender(<MemoryRouter><ArchivePreviewPanel archiveId="archive-2" onClose={vi.fn()} /></MemoryRouter>)
        expect(await screen.findByText('Arsip terbaru')).toBeInTheDocument()
        await act(async () => first.resolve(archive))
        expect(screen.queryByText('Berkas penetapan hak')).not.toBeInTheDocument()
        expect(mocks.getMasuk).not.toHaveBeenCalled()
        expect(screen.getByRole('link', { name: 'Buka detail lengkap' })).toHaveAttribute('href', '/arsip/detail/archive-2')
    })

    it('ignores an older source response when selection changes', async () => {
        const source = deferred()
        mocks.getMasuk.mockReturnValue(source.promise)
        const view = renderPanel()
        await waitFor(() => expect(mocks.getMasuk).toHaveBeenCalledWith('surat-1'))
        mocks.getArchive.mockResolvedValue({ ...archive, id: 'archive-2', sourceSuratId: null, uraianBerkas: 'Arsip terbaru' })
        view.rerender(<MemoryRouter><ArchivePreviewPanel archiveId="archive-2" onClose={vi.fn()} /></MemoryRouter>)
        expect(await screen.findByText('Arsip terbaru')).toBeInTheDocument()
        await act(async () => source.resolve(fileRecord))
        expect(screen.queryByText('dokumen.pdf')).not.toBeInTheDocument()
        expect(mocks.fetchPrivateFile).not.toHaveBeenCalled()
    })

    it.each([401, 403])('shows source permission failure %s without exposing a file action', async status => {
        mocks.getMasuk.mockRejectedValue(Object.assign(new Error('Forbidden'), { status }))
        renderPanel()
        expect(await screen.findByText('Anda tidak memiliki akses ke dokumen sumber arsip ini.')).toBeInTheDocument()
        expect(screen.getByText('Berkas penetapan hak')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Muat dokumen' })).not.toBeInTheDocument()
        expect(mocks.fetchPrivateFile).not.toHaveBeenCalled()
    })

    it('shows an unavailable source separately from a source without a digital file', async () => {
        mocks.getMasuk.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }))
        const view = renderPanel()
        expect(await screen.findByText('Dokumen sumber belum dapat diakses atau sudah tidak tersedia.')).toBeInTheDocument()
        view.unmount()
        renderPanel()
        expect(await screen.findByText('Belum ada berkas digital pada surat sumber.')).toBeInTheDocument()
    })

    it('retries a transient source failure without reloading archive metadata', async () => {
        mocks.getMasuk.mockRejectedValueOnce(new Error('Temporarily unavailable')).mockResolvedValue(fileRecord)
        renderPanel()
        fireEvent.click(await screen.findByRole('button', { name: 'Coba muat dokumen sumber lagi' }))
        expect(await screen.findByRole('button', { name: 'Muat dokumen' })).toBeInTheDocument()
        expect(mocks.getMasuk).toHaveBeenCalledTimes(2)
        expect(mocks.getArchive).toHaveBeenCalledTimes(1)
        expect(mocks.fetchPrivateFile).not.toHaveBeenCalled()
    })

    it.each([{ sourceSuratId: null }, { jenisArsip: 'lainnya' }])('does not guess a source for unsupported archive data %j', async fields => {
        mocks.getArchive.mockResolvedValue({ ...archive, ...fields })
        renderPanel()
        expect(await screen.findByText(/Arsip ini belum terhubung dengan surat sumber/)).toBeInTheDocument()
        expect(mocks.getMasuk).not.toHaveBeenCalled()
        expect(mocks.getKeluar).not.toHaveBeenCalled()
    })

    it.each([['masuk', 'surat_masuk'], ['keluar', 'surat_keluar']])('loads %s through the existing private preview only after explicit action', async (jenisArsip, entityType) => {
        mocks.getArchive.mockResolvedValue({ ...archive, jenisArsip })
        const sourceMock = jenisArsip === 'masuk' ? mocks.getMasuk : mocks.getKeluar
        sourceMock.mockResolvedValue(fileRecord)
        const view = renderPanel()
        const loadButton = await screen.findByRole('button', { name: 'Muat dokumen' })
        expect(sourceMock).toHaveBeenCalledWith('surat-1')
        expect(mocks.fetchPrivateFile).not.toHaveBeenCalled()
        fireEvent.click(loadButton)
        await screen.findByTitle('PDF Preview')
        expect(mocks.fetchPrivateFile).toHaveBeenCalledWith(`/api/files/${entityType}/surat-1`, expect.objectContaining({ signal: expect.any(AbortSignal) }))
        view.unmount()
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:archive-preview')
    })

    it('aborts an in-flight private preview and does not create a URL after closing', async () => {
        const bytes = deferred()
        mocks.getMasuk.mockResolvedValue(fileRecord)
        mocks.fetchPrivateFile.mockReturnValue(bytes.promise)
        const view = renderPanel()
        fireEvent.click(await screen.findByRole('button', { name: 'Muat dokumen' }))
        const signal = mocks.fetchPrivateFile.mock.calls[0][1].signal
        view.unmount()
        expect(signal.aborted).toBe(true)
        await act(async () => bytes.resolve(new Blob(['pdf'], { type: 'application/pdf' })))
        expect(createObjectURL).not.toHaveBeenCalled()
    })
})
