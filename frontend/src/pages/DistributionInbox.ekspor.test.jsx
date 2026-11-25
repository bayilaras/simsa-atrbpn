import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import DistributionInbox from './DistributionInbox'

// Rekap disposisi: tombol hanya untuk peran berizin ekspor; yang dikirim adalah
// kotak yang sedang dibuka beserta penyaring servernya.
const mocks = vi.hoisted(() => ({
    svc: { getInbox: vi.fn(), getOutbox: vi.fn(), getStats: vi.fn(), getById: vi.fn(), getKandidatPenyelesaian: vi.fn(), exportKotak: vi.fn() },
    toast: vi.fn(),
    user: { id: 'u-bppt', role: 'admin_unit', unitKerjaId: 'dir_bppt' },
}))
vi.mock('@/services/distribution.service', () => ({ default: mocks.svc, distributionService: mocks.svc }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))

const terbuka = { id: 'd1', status: 'received', masked: false, instruction: 'Mohon hadir', batasWaktu: '2026-09-30', sentAt: '2026-09-20T01:00:00Z',
    surat: { id: 's1', nomorSurat: 'SM-1/2026', perihal: 'Undangan koordinasi', dari: 'Pemda' }, sourceUnit: { id: 'sesditjen', name: 'Sesditjen' }, rangkaian: null }
const halaman = (rows) => ({ success: true, data: rows, pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 } })
const galatApi = (status, body) => Object.assign(new Error(body.message), { status, data: body, response: { status, data: body } })

/** Penyaring panggilan terakhir yang memuat Kotak Masuk, tanpa nomor halaman. */
function penyaringKotakMasuk() {
    const [unit, { page: _page, limit: _limit, ...penyaring }] = mocks.svc.getInbox.mock.lastCall
    return [unit, penyaring]
}

function tampil() {
    render(<MemoryRouter initialEntries={['/distribusi']}><DistributionInbox /></MemoryRouter>)
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = { id: 'u-bppt', role: 'admin_unit', unitKerjaId: 'dir_bppt' }
    mocks.svc.getInbox.mockResolvedValue(halaman([terbuka]))
    mocks.svc.getOutbox.mockResolvedValue(halaman([]))
    mocks.svc.getStats.mockResolvedValue({ inbox: { total: 1, pending: 0, received: 1, processed: 0, rejected: 0 }, outbox: { total: 0, pending: 0, processed: 0, rejected: 0 } })
    mocks.svc.exportKotak.mockResolvedValue('rekap.xlsx')
})
afterEach(cleanup)

describe('ekspor rekap disposisi', () => {
    it('staf tidak melihat tombol ekspor', async () => {
        mocks.user = { id: 'staf', role: 'staff', unitKerjaId: 'dir_bppt' }
        tampil()
        await screen.findByRole('link', { name: 'SM-1/2026' })
        expect(screen.queryByRole('button', { name: 'Ekspor Excel' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Ekspor PDF' })).toBeNull()
        expect(screen.queryByText(/Ekspor memuat seluruh/)).toBeNull()
    })

    it.each(['admin_unit', 'admin_sesditjen', 'auditor'])('%s melihat tombol ekspor dan keterangan cakupannya', async (role) => {
        mocks.user = { id: 'pengguna', role, unitKerjaId: 'dir_bppt' }
        tampil()
        await screen.findByRole('link', { name: 'SM-1/2026' })
        expect(screen.getByRole('button', { name: 'Ekspor Excel' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Ekspor PDF' })).toBeInTheDocument()
        expect(screen.getByText(/Ekspor memuat seluruh Kotak Masuk sesuai penyaring yang dipilih/)).toBeInTheDocument()
    })

    it('Kotak Masuk: penyaring ekspor sama dengan penyaring daftar di layar', async () => {
        tampil()
        await screen.findByRole('link', { name: 'SM-1/2026' })
        await waitFor(() => expect(screen.getByRole('button', { name: 'Ekspor Excel' })).toBeEnabled())

        fireEvent.click(screen.getByRole('button', { name: 'Ekspor Excel' }))
        await waitFor(() => expect(mocks.svc.exportKotak).toHaveBeenCalledTimes(1))
        expect(mocks.svc.exportKotak).toHaveBeenLastCalledWith('inbox', 'excel', ...penyaringKotakMasuk())
        expect(mocks.svc.exportKotak).toHaveBeenLastCalledWith('inbox', 'excel', 'dir_bppt', {})

        fireEvent.click(screen.getByRole('checkbox', { name: 'Lewat batas waktu' }))
        await waitFor(() => expect(mocks.svc.getInbox).toHaveBeenLastCalledWith('dir_bppt', { lewatBatas: true, page: 1, limit: 20 }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Ekspor PDF' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Ekspor PDF' }))
        await waitFor(() => expect(mocks.svc.exportKotak).toHaveBeenCalledTimes(2))
        expect(mocks.svc.exportKotak).toHaveBeenLastCalledWith('inbox', 'pdf', ...penyaringKotakMasuk())
        expect(mocks.svc.exportKotak).toHaveBeenLastCalledWith('inbox', 'pdf', 'dir_bppt', { lewatBatas: true })
        // Kata kunci di kotak cari hanya menyaring halaman di layar, tidak dikirim ke ekspor.
        fireEvent.change(screen.getByPlaceholderText(/Cari surat di kotak masuk/), { target: { value: 'Undangan' } })
        fireEvent.click(screen.getByRole('button', { name: 'Ekspor Excel' }))
        await waitFor(() => expect(mocks.svc.exportKotak).toHaveBeenCalledTimes(3))
        expect(mocks.svc.exportKotak).toHaveBeenLastCalledWith('inbox', 'excel', 'dir_bppt', { lewatBatas: true })
    })

    it('Kotak Keluar: mengekspor kotak keluar tanpa penyaring lewat batas waktu', async () => {
        tampil()
        await screen.findByRole('link', { name: 'SM-1/2026' })
        fireEvent.click(screen.getByRole('checkbox', { name: 'Lewat batas waktu' }))
        fireEvent.mouseDown(screen.getByRole('tab', { name: /Kotak Keluar/ }), { button: 0, ctrlKey: false })
        expect(await screen.findByText(/Ekspor memuat seluruh Kotak Keluar/)).toBeInTheDocument()
        await waitFor(() => expect(screen.getByRole('button', { name: 'Ekspor Excel' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Ekspor Excel' }))
        await waitFor(() => expect(mocks.svc.exportKotak).toHaveBeenCalledTimes(1))
        expect(mocks.svc.exportKotak).toHaveBeenLastCalledWith('outbox', 'excel', 'dir_bppt', {})
    })

    it('penolakan server ditampilkan dengan pesannya dan tombol aktif kembali', async () => {
        const pesan = 'Terlalu banyak permintaan export. Coba lagi setelah 1 menit.'
        mocks.svc.exportKotak.mockRejectedValue(galatApi(429, { error: 'Too Many Requests', message: pesan }))
        tampil()
        await screen.findByRole('link', { name: 'SM-1/2026' })
        await waitFor(() => expect(screen.getByRole('button', { name: 'Ekspor Excel' })).toBeEnabled())
        fireEvent.click(screen.getByRole('button', { name: 'Ekspor Excel' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: pesan, variant: 'destructive' })))
        expect(screen.getByRole('button', { name: 'Ekspor Excel' })).toBeEnabled()
    })
})
