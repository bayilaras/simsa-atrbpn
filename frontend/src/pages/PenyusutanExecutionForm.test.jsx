import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PenyusutanExecutionForm from './PenyusutanExecutionForm'

const mocks = vi.hoisted(() => ({ getExecutionOptions: vi.fn(), updateStatus: vi.fn(), uploadExecutionEvidence: vi.fn() }))
vi.mock('@/services/penyusutan.service', () => ({ penyusutanService: mocks }))
const batch = { id: 'batch-1', items: [{ arsipId: 'archive-1', arsip: { nomorBerkas: 'Berkas 001' } }] }
const options = { attachments: ['Berita acara.pdf', 'Keputusan.pdf', 'Pelaksanaan.pdf', 'Penugasan.pdf'].map((fileName, i) => ({ id: `doc-${i}`, fileName })),
    witnesses: [{ id: 'w1', name: 'Saksi A' }, { id: 'w2', name: 'Saksi B' }] }
async function fillForm() {
    await waitFor(() => expect(screen.getByLabelText('Berita acara selesai')).not.toBeDisabled())
    for (const [label, value] of [['Berita acara selesai', 'doc-0'], ['Keputusan/persetujuan pemusnahan', 'doc-1'],
        ['Bukti pelaksanaan', 'doc-2'], ['Dokumen penugasan saksi 1', 'doc-3'], ['Dokumen penugasan saksi 2', 'doc-3'],
        ['Pengguna saksi 1', 'w1'], ['Pengguna saksi 2', 'w2'], ['Waktu pelaksanaan (waktu perangkat)', '2026-09-10T10:00'],
        ['Metode dan uraian pelaksanaan', 'Pencacahan sesuai keputusan'],
        ['Penanganan media, salinan, replika, dan backup', 'Seluruh salinan dicatat dalam lampiran pelaksanaan.']]) {
        fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
}
beforeEach(() => {
    vi.resetAllMocks()
    mocks.getExecutionOptions.mockResolvedValue(options)
    mocks.updateStatus.mockResolvedValue({ status: 'executed' })
    mocks.uploadExecutionEvidence.mockResolvedValue({ success: true })
})
afterEach(cleanup)
describe('destruction evidence workflow', () => {
    it('submits selected documents and named witnesses only when the operator records completion', async () => {
        const complete = vi.fn()
        render(<PenyusutanExecutionForm batch={batch} unitKerjaId="unit-1" onComplete={complete} />)
        await fillForm()
        expect(mocks.updateStatus).not.toHaveBeenCalled()
        fireEvent.submit(screen.getByRole('button', { name: 'Simpan bukti dan catat selesai' }).closest('form'))
        await waitFor(() => expect(complete).toHaveBeenCalledOnce())
        expect(mocks.updateStatus).toHaveBeenCalledWith('batch-1', 'unit-1', { executionEvidence: expect.objectContaining({
            beritaAcaraAttachmentId: 'doc-0', decisionAttachmentId: 'doc-1', executionProofAttachmentId: 'doc-2',
            witnesses: [{ userId: 'w1', authorityAttachmentId: 'doc-3' }, { userId: 'w2', authorityAttachmentId: 'doc-3' }],
        }) })
    })
    it('keeps input after server rejection and displays the actionable reason', async () => {
        mocks.updateStatus.mockRejectedValue(new Error('Saksi harus berbeda dari pencatat pelaksanaan.'))
        render(<PenyusutanExecutionForm batch={batch} unitKerjaId="unit-1" onComplete={vi.fn()} />)
        await fillForm()
        fireEvent.submit(screen.getByRole('button', { name: 'Simpan bukti dan catat selesai' }).closest('form'))
        expect(await screen.findByRole('alert')).toHaveTextContent('Saksi harus berbeda')
        expect(screen.getByLabelText('Berita acara selesai')).toHaveValue('doc-0')
    })
    it('uploads evidence to the selected archive and explains quarantine without marking it verified', async () => {
        mocks.getExecutionOptions.mockResolvedValue({ attachments: [], witnesses: [] })
        render(<PenyusutanExecutionForm batch={batch} unitKerjaId="unit-1" onComplete={vi.fn()} />)
        const file = new File(['%PDF-1.7'], 'BA-selesai.pdf', { type: 'application/pdf' })
        fireEvent.change(screen.getByLabelText(/Unggah dokumen bukti/), { target: { files: [file] } })
        fireEvent.click(screen.getByRole('button', { name: 'Unggah bukti' }))
        await waitFor(() => expect(mocks.uploadExecutionEvidence).toHaveBeenCalledWith('batch-1', 'unit-1', 'archive-1', file))
        expect(await screen.findByText(/Bukti diunggah ke karantina/)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Simpan bukti dan catat selesai' })).toBeDisabled()
    })
    it('does not reopen a previous batch after its request finishes in the background', async () => {
        let finish
        mocks.updateStatus.mockImplementation(() => new Promise(resolve => { finish = resolve }))
        const complete = vi.fn()
        const view = render(<PenyusutanExecutionForm batch={batch} unitKerjaId="unit-1" onComplete={complete} />)
        await fillForm()
        fireEvent.submit(screen.getByRole('button', { name: 'Simpan bukti dan catat selesai' }).closest('form'))
        view.unmount()
        finish({ status: 'executed' })
        await Promise.resolve()
        expect(complete).not.toHaveBeenCalled()
    })
})
