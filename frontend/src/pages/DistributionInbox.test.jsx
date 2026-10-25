import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import DistributionInbox from './DistributionInbox'

const mocks = vi.hoisted(() => ({
    svc: { getInbox: vi.fn(), getOutbox: vi.fn(), getStats: vi.fn(), receive: vi.fn(), process: vi.fn(), reject: vi.fn(), getKandidatPenyelesaian: vi.fn(), getById: vi.fn() },
    toast: vi.fn(),
}))
vi.mock('@/services/distribution.service', () => ({ default: mocks.svc, distributionService: mocks.svc }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-bppt', role: 'admin_unit', unitKerjaId: 'dir_bppt' } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))

const terbuka = { id: 'd1', status: 'received', masked: false, instruction: 'Mohon hadir', batasWaktu: '2026-09-30', sentAt: '2026-09-20T01:00:00Z',
    surat: { id: 's1', nomorSurat: 'SM-1/2026', perihal: 'Undangan koordinasi', dari: 'Pemda' }, sourceUnit: { id: 'sesditjen', name: 'Sesditjen' },
    rangkaian: { id: 'rs-1', kode: 'RS-2026-000001' } }
const tersamar = { id: 'd2', status: 'sent', masked: true, instruction: null, batasWaktu: null, sentAt: '2026-09-21T01:00:00Z',
    surat: { id: null, nomorSurat: null, perihal: null, label: 'Dikecualikan' }, sourceUnit: { id: 'sesditjen', name: 'Sesditjen' }, rangkaian: null }

function tampil(entry = '/distribusi') {
    render(<MemoryRouter initialEntries={[entry]}><Routes>
        <Route path="/distribusi" element={<DistributionInbox />} />
        <Route path="/surat/keluar/tambah" element={<h1>Form surat keluar</h1>} />
    </Routes></MemoryRouter>)
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.svc.getInbox.mockResolvedValue([terbuka, tersamar])
    mocks.svc.getOutbox.mockResolvedValue([])
    mocks.svc.getStats.mockResolvedValue({ inbox: { total: 2, pending: 1, received: 1, processed: 0, rejected: 0 }, outbox: { total: 0, pending: 0, processed: 0, rejected: 0 } })
    mocks.svc.getKandidatPenyelesaian.mockResolvedValue([{ id: 'sk-1', nomorSurat: 'ND-1/2026', perihal: 'Tindak lanjut', tanggalSurat: '2026-09-22' }])
    mocks.svc.process.mockResolvedValue({ id: 'd1', status: 'processed' })
})
afterEach(cleanup)

describe('Kotak Disposisi', () => {
    it('baris terbaca menjadi tautan ke detail; baris tersamar hanya dapat ditolak', async () => {
        tampil()
        expect(await screen.findByRole('link', { name: 'SM-1/2026' })).toHaveAttribute('href', '/surat/masuk/s1')
        const baris = screen.getByText('Dikecualikan').closest('tr')
        expect(within(baris).getByText('Ajukan akses / hubungi TU')).toBeInTheDocument()
        expect(within(baris).queryByRole('button', { name: 'Terima Surat' })).toBeNull()
        expect(within(baris).queryByRole('button', { name: 'Penyelesaian' })).toBeNull()
        expect(within(baris).getByRole('button', { name: 'Tolak & Kembalikan' })).toBeInTheDocument()
    })

    it('penyelesaian dengan surat keluar kandidat atau catatan ≥10 karakter', async () => {
        tampil()
        const baris = (await screen.findByRole('link', { name: 'SM-1/2026' })).closest('tr')
        fireEvent.click(within(baris).getByRole('button', { name: 'Penyelesaian' }))
        const dialog = within(await screen.findByRole('dialog'))
        fireEvent.click(await dialog.findByRole('radio', { name: /ND-1\/2026/ }))
        fireEvent.click(dialog.getByRole('button', { name: 'Simpan Penyelesaian' }))
        await waitFor(() => expect(mocks.svc.process).toHaveBeenCalledWith('d1', 'dir_bppt', { penyelesaianSuratKeluarId: 'sk-1' }))
    })

    it('catatan kurang dari 10 karakter tidak dapat disimpan', async () => {
        tampil()
        const baris = (await screen.findByRole('link', { name: 'SM-1/2026' })).closest('tr')
        fireEvent.click(within(baris).getByRole('button', { name: 'Penyelesaian' }))
        const dialog = within(await screen.findByRole('dialog'))
        fireEvent.click(dialog.getByRole('radio', { name: /Catatan penyelesaian/ }))
        fireEvent.change(dialog.getByLabelText('Isi catatan penyelesaian'), { target: { value: 'singkat' } })
        expect(dialog.getByRole('button', { name: 'Simpan Penyelesaian' })).toBeDisabled()
    })

    it('Buat Tindak Lanjut membuka form surat keluar dengan disposisi terkait', async () => {
        tampil()
        const baris = (await screen.findByRole('link', { name: 'SM-1/2026' })).closest('tr')
        fireEvent.click(within(baris).getByRole('button', { name: 'Buat Tindak Lanjut' }))
        expect(await screen.findByRole('heading', { name: 'Form surat keluar' })).toBeInTheDocument()
    })

    it('filter lewat batas waktu meminta server dengan lewatBatas', async () => {
        tampil()
        await screen.findByRole('link', { name: 'SM-1/2026' })
        fireEvent.click(screen.getByRole('checkbox', { name: 'Lewat batas waktu' }))
        await waitFor(() => expect(mocks.svc.getInbox).toHaveBeenLastCalledWith('dir_bppt', { lewatBatas: true }))
    })

    it('?penyelesaian=<id> dari detail surat langsung membuka dialog penyelesaian', async () => {
        tampil('/distribusi?penyelesaian=d1')
        expect(await screen.findByRole('dialog', { name: 'Penyelesaian Disposisi' })).toBeInTheDocument()
    })

    // F-I2 fallback: disposisi di luar halaman kotak yang dimuat diambil lewat GET /distributions/:id.
    it('?penyelesaian=<id> di luar halaman ini dimuat lewat getById lalu membuka dialog', async () => {
        mocks.svc.getById.mockResolvedValue({ id: 'd9', status: 'sent', masked: false })
        tampil('/distribusi?penyelesaian=d9')
        expect(await screen.findByRole('dialog', { name: 'Penyelesaian Disposisi' })).toBeInTheDocument()
        expect(mocks.svc.getById).toHaveBeenCalledWith('d9')
        await waitFor(() => expect(mocks.svc.getKandidatPenyelesaian).toHaveBeenCalledWith('d9', 'dir_bppt'))
    })

    it('?penyelesaian=<id> kotak kosong / disposisi selesai: tidak ada dialog, pengguna diberi tahu', async () => {
        mocks.svc.getInbox.mockResolvedValue([])
        mocks.svc.getById.mockResolvedValue({ id: 'd9', status: 'processed', masked: false })
        tampil('/distribusi?penyelesaian=d9')
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Disposisi tidak dapat diselesaikan', variant: 'destructive' })))
        expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('?penyelesaian=<id> pada baris tersamar tidak membuka dialog', async () => {
        tampil('/distribusi?penyelesaian=d2')
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Disposisi tidak dapat diselesaikan' })))
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(mocks.svc.getById).not.toHaveBeenCalled()
    })

    it('baris tersamar tetap tampil saat pencarian kosong', async () => {
        tampil()
        await screen.findByRole('link', { name: 'SM-1/2026' })
        expect(screen.getByText('Dikecualikan')).toBeInTheDocument()
    })

    it('baris tersamar tersembunyi saat ada kata kunci pencarian', async () => {
        tampil()
        await screen.findByRole('link', { name: 'SM-1/2026' })
        fireEvent.change(screen.getByPlaceholderText(/Cari surat di kotak masuk/), { target: { value: 'Undangan' } })
        expect(screen.queryByText('Dikecualikan')).toBeNull()
    })
})
