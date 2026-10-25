import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PreservationHistory from './PreservationHistory'
import ExternalPreservationFields from './ExternalPreservationFields'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), upload: vi.fn() }))
vi.mock('@/services/api', () => ({ api: mocks }))
vi.mock('@/services/arsip-attachment-upload.service', () => ({ uploadArsipAttachment: mocks.upload }))
const event = { id: 'event-1', action: 'conversion', performedAt: '2020-01-01T00:00:00Z', performedBy: { name: 'Petugas uji' } }
beforeEach(() => vi.resetAllMocks())
afterEach(cleanup)
describe('preservation evidence presentation', () => {
    it('shows historical notes as unverified and safely renders incomplete JSON text', async () => {
        mocks.get.mockResolvedValue([{ ...event, recordingMode: 'legacy_unverified', details: '{unfinished JSON' }])
        render(<PreservationHistory arsipId="e1" />)
        expect(await screen.findByText(/Catatan lama: pelaksanaan dan bukti belum diverifikasi/)).toBeInTheDocument()
        expect(screen.getByText('{unfinished JSON')).toBeInTheDocument()
    })
    it('distinguishes a real mismatch from a recorded external conversion and refreshes new events', async () => {
        mocks.get.mockResolvedValueOnce([{ ...event, action: 'integrity_check', recordingMode: 'system_integrity_check', evidenceSnapshot: { result: 'mismatch' } }])
        const view = render(<PreservationHistory arsipId="e1" refreshVersion={0} />)
        expect(await screen.findByText('Pemeriksaan sistem: hash tidak cocok')).toBeInTheDocument()
        mocks.get.mockResolvedValueOnce([{ ...event, recordingMode: 'external_activity_recorded', evidenceSnapshot: { result: 'evidence_recorded' } }])
        view.rerender(<PreservationHistory arsipId="e1" refreshVersion={1} />)
        expect(await screen.findByText(/Tindakan eksternal dicatat dengan bukti; tidak dijalankan oleh SIMSA/)).toBeInTheDocument()
        expect(mocks.get).toHaveBeenCalledTimes(2)
    })
    it('shows options by filename and uploads new results through the existing private attachment API', async () => {
        const archiveId = '550e8400-e29b-41d4-a716-446655440001'
        mocks.get.mockResolvedValue({ arsipId: archiveId, attachments: [{ id: 'output', fileName: 'Hasil.pdf' }, { id: 'proof', fileName: 'Kendali mutu.pdf' }] })
        mocks.upload.mockResolvedValue({ success: true })
        const change = vi.fn()
        render(<ExternalPreservationFields electronicId="e1" data={{}} onChange={change} />)
        expect(await screen.findAllByRole('option', { name: 'Hasil.pdf' })).toHaveLength(2)
        fireEvent.change(screen.getByLabelText('Berkas hasil tindakan eksternal'), { target: { value: 'output' } })
        expect(change).toHaveBeenCalledWith('outputAttachmentId', 'output')
        const file = new File(['%PDF-1.7'], 'Hasil.pdf', { type: 'application/pdf' })
        fireEvent.change(screen.getByLabelText(/Unggah hasil atau bukti baru/), { target: { files: [file] } })
        fireEvent.click(screen.getByRole('button', { name: 'Unggah lampiran' }))
        await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith(archiveId, file))
        expect(await screen.findByText(/Lampiran masuk karantina/)).toBeInTheDocument()
    })
    it('shows a history error and can retry instead of presenting an empty register', async () => {
        mocks.get.mockRejectedValueOnce(new Error('Riwayat tidak tersedia'))
        render(<PreservationHistory arsipId="e1" />)
        expect(await screen.findByRole('alert')).toHaveTextContent('Riwayat tidak tersedia')
        mocks.get.mockResolvedValueOnce([{ ...event, recordingMode: 'legacy_unverified' }])
        fireEvent.click(screen.getByRole('button', { name: 'Muat ulang riwayat' }))
        expect(await screen.findByText(/Catatan lama/)).toBeInTheDocument()
    })
})
