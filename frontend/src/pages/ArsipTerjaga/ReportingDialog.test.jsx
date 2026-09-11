import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const service = vi.hoisted(() => ({ getReports: vi.fn(), createReport: vi.fn(), transitionReport: vi.fn(), uploadEvidence: vi.fn(), downloadEvidence: vi.fn() }))
vi.mock('@/services/arsip-terjaga.service', () => ({ arsipTerjagaService: service }))
import ReportingDialog from './ReportingDialog'

const item = { id: 'designation', arsipId: 'archive', nomorBerkas: 'BERKAS-1' }
const open = (result) => {
    service.getReports.mockResolvedValue({ data: { reports: [], attachments: [], canManage: true, ...result } })
    render(<ReportingDialog open onOpenChange={vi.fn()} item={item} onSaved={vi.fn()} />)
}
beforeEach(() => vi.clearAllMocks())
describe('reporting evidence dialog', () => {
    it('creates only a draft and explains the scope of the record', async () => {
        service.createReport.mockResolvedValue({ success: true })
        open()
        expect(await screen.findByText(/Pencatatan dan pemeriksaan bukti internal/)).toBeInTheDocument()
        fireEvent.change(screen.getByLabelText('Nomor laporan'), { target: { value: 'LAP-1' } })
        fireEvent.click(screen.getByRole('button', { name: 'Simpan draf laporan' }))
        await waitFor(() => expect(service.createReport).toHaveBeenCalledWith('designation', expect.objectContaining({ nomorLaporan: 'LAP-1' })))
        expect(screen.queryByText('Patuh')).not.toBeInTheDocument()
        expect(screen.queryByText('Terverifikasi ANRI')).not.toBeInTheDocument()
    })
    it('offers files by name, requires notes and records evidence before moving to sent', async () => {
        open({ reports: [{ id: 'report', nomorLaporan: 'LAP-1', status: 'draft' }], attachments: [{ id: 'file-1', fileName: 'Pengiriman resmi.pdf', released: true }] })
        await screen.findByText('LAP-1')
        expect(screen.getByRole('button', { name: 'Catat bukti pengiriman' })).toBeDisabled()
        fireEvent.change(screen.getByLabelText('Lampiran bukti'), { target: { value: 'file-1' } })
        fireEvent.change(screen.getByLabelText('Catatan pemeriksaan atau tindakan'), { target: { value: 'Bukti sesuai pengiriman yang dicatat.' } })
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Catat bukti pengiriman' })) })
        expect(service.transitionReport).toHaveBeenCalledWith('designation', 'report', expect.objectContaining({ action: 'send', attachmentId: 'file-1' }))
    })
    it('keeps verification unavailable to a non-independent actor', async () => {
        open({ reports: [{ id: 'report', nomorLaporan: 'LAP-1', status: 'received', canVerify: false }] })
        await screen.findByText('LAP-1')
        expect(screen.queryByRole('button', { name: 'Verifikasi bukti internal' })).not.toBeInTheDocument()
        expect(screen.getByText(/pemeriksa independen/)).toBeInTheDocument()
    })
    it('shows a service error without presenting an empty success state', async () => {
        service.getReports.mockRejectedValue(new Error('Akses tidak tersedia'))
        render(<ReportingDialog open onOpenChange={vi.fn()} item={item} onSaved={vi.fn()} />)
        expect(await screen.findByRole('alert')).toHaveTextContent('Akses tidak tersedia')
        expect(screen.queryByRole('button', { name: 'Simpan draf laporan' })).not.toBeInTheDocument()
    })
})
