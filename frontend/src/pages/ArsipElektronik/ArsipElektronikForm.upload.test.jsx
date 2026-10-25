import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ArsipElektronikForm from './ArsipElektronikForm'
vi.mock('@/context/AuthContext', async () => ({ default: (await import('react')).createContext(null) }))
const state = vi.hoisted(() => ({ upload: vi.fn(), get: vi.fn(), files: true }))
vi.mock('@/services/arsip-attachment-upload.service', () => ({ uploadArsipAttachment: state.upload }))
vi.mock('@/services/api', () => ({ default: { get: state.get } }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: true, fileUploads: state.files } }) }))
const arsipId = '20000000-0000-4000-8000-000000000001'
function Form() {
    const [form, setForm] = useState({ arsipId, fileAttachmentId: '', sourceType: 'born_digital', jumlahHalaman: '', mediaAsal: '', tanggalDigitalisasi: '', alatDigitalisasi: '', softwareDigitalisasi: '', catatanKonversi: '' })
    return <ArsipElektronikForm open onOpenChange={vi.fn()} form={form} setForm={setForm} onSubmit={vi.fn()} />
}
beforeEach(() => { vi.clearAllMocks(); state.files = true; state.get.mockReset().mockResolvedValue({ data: [] }) })
afterEach(cleanup)
describe('electronic archive attachment picker', () => {
    it('uses the shared target-bound upload and waits for server registration before selecting a file', async () => {
        let finish
        state.upload.mockReturnValue(new Promise(resolve => { finish = resolve }))
        render(<Form />)
        const file = new File([new Uint8Array(10 * 1024 * 1024)], 'arsip.pdf', { type: 'application/pdf' })
        fireEvent.change(screen.getByLabelText('Unggah lampiran arsip PDF'), { target: { files: [file] } })
        expect(state.upload).toHaveBeenCalledWith(arsipId, file)
        expect(screen.getByRole('button', { name: 'Cari' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Batal' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Registrasikan' })).toBeDisabled()
        await act(async () => finish({ data: { id: 'attachment', fileName: 'arsip.pdf', sha256: 'abc123', malwareScanStatus: 'not_scanned' } }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Registrasikan' })).toBeEnabled())
    })
    it('keeps file capability and PDF validation in front of any upload request', async () => {
        render(<Form />)
        fireEvent.change(screen.getByLabelText('Unggah lampiran arsip PDF'), { target: { files: [new File(['image'], 'foto.png', { type: 'image/png' })] } })
        expect(await screen.findByText(/Hanya.*PDF/)).toBeInTheDocument()
        expect(state.upload).not.toHaveBeenCalled()
        cleanup(); state.files = false; render(<Form />)
        expect(screen.getByLabelText('Unggah lampiran arsip PDF')).toBeDisabled()
    })
    it.each(['success', 'failure'])('ignores an old archive response after the selected archive changes (%s)', async (outcome) => {
        let finishOld, failOld
        state.get.mockImplementationOnce(() => new Promise((resolve, reject) => { finishOld = resolve; failOld = reject }))
            .mockResolvedValueOnce({ data: [{ id: 'attachment-b', fileName: 'baru.pdf', malwareScanStatus: 'clean' }] })
        const base = { sourceType: 'born_digital', jumlahHalaman: '', mediaAsal: '', tanggalDigitalisasi: '', alatDigitalisasi: '', softwareDigitalisasi: '', catatanKonversi: '' }
        const props = { open: true, onOpenChange: vi.fn(), setForm: vi.fn(), onSubmit: vi.fn() }
        const { rerender } = render(<ArsipElektronikForm {...props} form={{ ...base, arsipId: 'archive-a', fileAttachmentId: 'attachment-a' }} />)
        await waitFor(() => expect(state.get).toHaveBeenCalledTimes(1))
        const signal = state.get.mock.calls[0][2].signal
        rerender(<ArsipElektronikForm {...props} form={{ ...base, arsipId: 'archive-b', fileAttachmentId: 'attachment-b' }} />)
        expect(await screen.findByText(/telah lolos pemeriksaan antivirus/)).toBeInTheDocument()
        expect(signal.aborted).toBe(true)
        await act(async () => {
            if (outcome === 'success') finishOld({ data: [{ id: 'attachment-a', fileName: 'lama.pdf', malwareScanStatus: 'not_scanned' }] })
            else failOld(new Error('Kesalahan arsip lama'))
        })
        expect(screen.getByText(/telah lolos pemeriksaan antivirus/)).toBeInTheDocument()
        expect(screen.queryByText('Kesalahan arsip lama')).not.toBeInTheDocument()
    })
    it('aborts attachment status work on close and does not reuse its result after reopening', async () => {
        let finishOld
        state.get.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
            .mockResolvedValueOnce({ data: [{ id: 'attachment', malwareScanStatus: 'scan_error' }] })
        const form = { arsipId, fileAttachmentId: 'attachment', sourceType: 'born_digital', jumlahHalaman: '', mediaAsal: '', tanggalDigitalisasi: '', alatDigitalisasi: '', softwareDigitalisasi: '', catatanKonversi: '' }
        const props = { form, setForm: vi.fn(), onOpenChange: vi.fn(), onSubmit: vi.fn() }
        const { rerender } = render(<ArsipElektronikForm {...props} open />)
        await waitFor(() => expect(state.get).toHaveBeenCalledTimes(1))
        const signal = state.get.mock.calls[0][2].signal
        rerender(<ArsipElektronikForm {...props} open={false} />)
        expect(signal.aborted).toBe(true)
        rerender(<ArsipElektronikForm {...props} open />)
        await screen.findByText(/Hubungi pengelola/)
        await act(async () => finishOld({ data: [{ id: 'attachment', malwareScanStatus: 'clean' }] }))
        expect(screen.getByText(/Hubungi pengelola/)).toBeInTheDocument()
        expect(screen.queryByText(/telah lolos/)).not.toBeInTheDocument()
    })
    it('preserves the last known attachment after a failed refresh and clears its error on a later successful retry', async () => {
        state.get.mockResolvedValueOnce({ data: [{ id: 'attachment', malwareScanStatus: 'not_scanned' }] })
            .mockRejectedValueOnce(new Error('Koneksi pemeriksaan terputus'))
            .mockResolvedValueOnce({ data: [{ id: 'attachment', malwareScanStatus: 'clean' }] })
        const form = { arsipId, fileAttachmentId: 'attachment', sourceType: 'born_digital', jumlahHalaman: '', mediaAsal: '', tanggalDigitalisasi: '', alatDigitalisasi: '', softwareDigitalisasi: '', catatanKonversi: '' }
        render(<ArsipElektronikForm open form={form} setForm={vi.fn()} onOpenChange={vi.fn()} onSubmit={vi.fn()} />)
        fireEvent.click(await screen.findByRole('button', { name: 'Periksa status' }))
        await screen.findByText('Koneksi pemeriksaan terputus')
        expect(screen.getByText(/tersimpan dan menunggu/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Periksa status' }))
        expect(await screen.findByText(/telah lolos pemeriksaan antivirus/)).toBeInTheDocument()
        expect(screen.queryByText('Koneksi pemeriksaan terputus')).not.toBeInTheDocument()
        expect(state.get).toHaveBeenCalledTimes(3)
    })
})
