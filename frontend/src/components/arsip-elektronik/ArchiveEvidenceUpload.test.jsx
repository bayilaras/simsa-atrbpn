import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReportingDialog from '@/pages/ArsipTerjaga/ReportingDialog'
import PenyusutanExecutionForm from '@/pages/PenyusutanExecutionForm'
import ExternalPreservationFields from './ExternalPreservationFields'

const mocks = vi.hoisted(() => ({ reports: vi.fn(), reportUpload: vi.fn(), executionOptions: vi.fn(), executionUpload: vi.fn(), get: vi.fn(), post: vi.fn() }))
vi.mock('@/services/arsip-terjaga.service', () => ({ arsipTerjagaService: { getReports: mocks.reports, uploadEvidence: mocks.reportUpload } }))
vi.mock('@/services/penyusutan.service', () => ({ penyusutanService: { getExecutionOptions: mocks.executionOptions, uploadExecutionEvidence: mocks.executionUpload } }))
vi.mock('@/services/api', () => ({ api: { get: mocks.get, post: mocks.post } }))
vi.mock('@/services/arsip-attachment-upload.service', () => ({ uploadArsipAttachment: (...args) => mocks.post(...args) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: true, fileUploads: true } }) }))

const workflows = [
    { name: 'pelaporan terjaga', render: () => render(<ReportingDialog open onOpenChange={vi.fn()} item={{ id: 'designation', arsipId: 'archive' }} />), label: /Unggah lampiran bukti/, ready: 'Lampiran bukti', upload: () => mocks.reportUpload },
    { name: 'bukti pemusnahan', render: () => render(<PenyusutanExecutionForm batch={{ id: 'batch', items: [{ arsipId: 'archive' }] }} unitKerjaId="unit" />), label: /Unggah dokumen bukti/, ready: 'Berita acara selesai', button: 'Unggah bukti', upload: () => mocks.executionUpload },
    { name: 'bukti preservasi', render: () => render(<ExternalPreservationFields electronicId="electronic" data={{}} onChange={vi.fn()} />), label: /Unggah hasil atau bukti baru/, ready: 'Berkas hasil tindakan eksternal', button: 'Unggah lampiran', upload: () => mocks.post },
]

beforeEach(() => {
    vi.clearAllMocks()
    mocks.reports.mockResolvedValue({ data: { reports: [{ id: 'report', nomorLaporan: 'LAP-1', status: 'draft' }], attachments: [], canManage: true } })
    mocks.executionOptions.mockResolvedValue({ attachments: [], witnesses: [] })
    mocks.get.mockResolvedValue({ attachments: [], arsipId: 'archive' })
    mocks.reportUpload.mockResolvedValue({ success: true })
    mocks.executionUpload.mockResolvedValue({ success: true })
    mocks.post.mockResolvedValue({ success: true })
})
afterEach(cleanup)

describe.each(workflows)('PDF evidence picker: $name', workflow => {
    async function open() {
        workflow.render()
        await waitFor(() => expect(screen.getByLabelText(workflow.ready)).not.toBeDisabled())
        return screen.getByLabelText(workflow.label)
    }

    it.each([
        ['gambar', () => new File(['image'], 'bukti.png', { type: 'image/png' }), /Hanya.*PDF/],
        ['PDF terlalu besar', () => new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'bukti.pdf', { type: 'application/pdf' }), /10 MiB/],
    ])('rejects %s before any upload request', async (_label, makeFile, message) => {
        const input = await open()
        fireEvent.change(input, { target: { files: [makeFile()] } })
        if (workflow.button) fireEvent.click(screen.getByRole('button', { name: workflow.button }))
        expect(await screen.findByRole('alert')).toHaveTextContent(message)
        expect(workflow.upload()).not.toHaveBeenCalled()
    })

    it('passes a PDF of exactly 10 MiB and keeps the quarantine explanation', async () => {
        const input = await open()
        expect(input).toHaveAttribute('accept', '.pdf,application/pdf')
        expect(screen.getByText(/10 MiB/)).toBeInTheDocument()
        const file = new File([new Uint8Array(10 * 1024 * 1024)], 'bukti.pdf', { type: 'application/pdf' })
        fireEvent.change(input, { target: { files: [file] } })
        if (workflow.button) fireEvent.click(screen.getByRole('button', { name: workflow.button }))
        await waitFor(() => expect(workflow.upload()).toHaveBeenCalledOnce())
        expect(await screen.findByText(/Bukti diunggah ke karantina|Lampiran masuk karantina|Tunggu pemeriksaan antivirus/)).toBeInTheDocument()
    })
})
