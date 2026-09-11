import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ArsipElektronikForm from './ArsipElektronikForm'
const state = vi.hoisted(() => ({ upload: vi.fn(), files: true }))
vi.mock('@/services/arsip-attachment-upload.service', () => ({ uploadArsipAttachment: state.upload }))
vi.mock('@/services/api', () => ({ default: { get: vi.fn() } }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: true, fileUploads: state.files } }) }))
const arsipId = '20000000-0000-4000-8000-000000000001'
function Form() {
    const [form, setForm] = useState({ arsipId, fileAttachmentId: '', sourceType: 'born_digital', jumlahHalaman: '', mediaAsal: '', tanggalDigitalisasi: '', alatDigitalisasi: '', softwareDigitalisasi: '', catatanKonversi: '' })
    return <ArsipElektronikForm open onOpenChange={vi.fn()} form={form} setForm={setForm} onSubmit={vi.fn()} />
}
beforeEach(() => { vi.clearAllMocks(); state.files = true })
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
})
