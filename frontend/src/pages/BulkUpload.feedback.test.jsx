import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BulkUpload from './BulkUpload'

const upload = vi.hoisted(() => ({ state: {} }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'super_admin' } }) }))
vi.mock('@/hooks/use-required-unit-kerja-scope', () => ({ useRequiredUnitKerjaScope: () => ({ unitKerjaId: 'dirjen' }) }))
vi.mock('@/components/RequiredUnitKerjaScope', () => ({ RequiredUnitKerjaScope: () => null }))
vi.mock('@/hooks/useOCRUpload', () => ({ useOCRUpload: () => upload.state }))
vi.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }))

function show() { return render(<MemoryRouter><BulkUpload /></MemoryRouter>) }

describe('upload feedback reflects its actual phase', () => {
    beforeEach(() => { upload.state = { files: [], batch: null, isUploading: false,
        isProcessing: false, isResuming: false, progress: null } })

    it('does not invent a percentage while the upload is awaiting the server', () => {
        upload.state.isUploading = true
        show()
        expect(screen.getByRole('status')).toHaveTextContent('Mengunggah berkas')
        expect(screen.getByRole('status')).toHaveTextContent('penerimaan berkas oleh server')
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Pilih berkas PDF untuk diunggah' })).not.toBeInTheDocument()
    })

    it('exposes the real OCR progress to assistive technology', () => {
        upload.state.isProcessing = true
        upload.state.progress = { percentage: 50, processed: 2, total: 4 }
        show()
        expect(screen.getByRole('progressbar', { name: 'Kemajuan ekstraksi dokumen' })).toHaveAttribute('aria-valuenow', '50')
        expect(screen.getByText('2 dari 4 berkas diproses')).toBeInTheDocument()
        expect(screen.getByRole('status')).toHaveTextContent('Periksa hasil ekstraksi')
    })

    it('uses a recovery message until the saved batch status is known', () => {
        upload.state.isResuming = true
        show()
        expect(screen.getByRole('status')).toHaveTextContent('Memulihkan proses tersimpan')
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })

    it('moves from upload through OCR to review without leaving the previous phase visible', async () => {
        upload.state.isUploading = true
        const view = show()
        expect(screen.getByRole('status')).toHaveTextContent('Mengunggah berkas')
        upload.state = { ...upload.state, isUploading: false, isProcessing: true,
            progress: { percentage: 50, processed: 1, total: 2 } }
        view.rerender(<MemoryRouter><BulkUpload /></MemoryRouter>)
        expect(screen.getByRole('status')).toHaveTextContent('Mengekstrak informasi')
        upload.state = { ...upload.state, isProcessing: false, batch: { items: [] } }
        view.rerender(<MemoryRouter><BulkUpload /></MemoryRouter>)
        expect(await screen.findByText('Hasil Ekstraksi Data')).toBeInTheDocument()
        await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })
})
