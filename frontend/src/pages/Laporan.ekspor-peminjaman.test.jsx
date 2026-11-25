import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Laporan from './Laporan'

// Tab Peminjaman: tombol ekspor hanya untuk peran berizin ekspor, dan penyaring
// yang dikirim ke ekspor sama dengan penyaring yang memuat tabel di layar.
const mocks = vi.hoisted(() => ({
    user: { id: 'admin', role: 'admin_unit', unitKerjaId: 'unit-a' },
    toast: vi.fn(),
    report: {
        getSummaryReport: vi.fn(),
        getSuratMasukReport: vi.fn(),
        getSuratKeluarReport: vi.fn(),
        getArsipReport: vi.fn(),
        getLendingReport: vi.fn(),
        exportReport: vi.fn(),
    },
}))

vi.mock('react-chartjs-2', () => ({ Bar: () => <canvas /> }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
// useToast asli memberi fungsi toast yang stabil; loadData bergantung padanya.
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/report.service', () => ({ reportService: mocks.report }))
vi.mock('@/components/ui/select', () => ({
    Select: ({ children, value, onValueChange }) => (
        <select aria-label="Pilihan" value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }) => <>{children}</>,
    SelectItem: ({ children, value }) => <option value={value}>{children}</option>,
}))

const PINJAMAN = [
    { id: 'p1', lendingType: 'arsip', nomorBerkas: 'B-01/2026', uraianBerkas: 'Berkas pengadaan', kodeBoks: null, namaBoks: null,
        borrowerName: 'Sari', departmentUnit: 'Subbag TU', borrowDate: '2026-09-01', dueDate: '2026-09-10', returnDate: null, status: 'overdue' },
    { id: 'p2', lendingType: 'box', nomorBerkas: null, uraianBerkas: null, kodeBoks: 'BX-7', namaBoks: 'Boks Keuangan',
        borrowerName: 'Budi', departmentUnit: null, borrowDate: '2026-09-05', dueDate: '2026-09-30', returnDate: null, status: 'borrowed' },
]

function bukaTabPeminjaman() {
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Peminjaman', exact: true }), { button: 0, ctrlKey: false })
}

/** Penyaring panggilan terakhir yang memuat tabel, tanpa nomor halaman. */
function penyaringTabel() {
    const { page: _page, limit: _limit, ...penyaring } = mocks.report.getLendingReport.mock.lastCall[0]
    return Object.fromEntries(Object.entries(penyaring).filter(([, nilai]) => nilai !== undefined && nilai !== ''))
}
function penyaringEkspor(panggilan = 0) {
    const [type, format, params] = mocks.report.exportReport.mock.calls[panggilan]
    return { type, format, params: Object.fromEntries(Object.entries(params).filter(([, nilai]) => nilai !== undefined && nilai !== '')) }
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = { id: 'admin', role: 'admin_unit', unitKerjaId: 'unit-a' }
    mocks.report.getSummaryReport.mockResolvedValue({ suratMasuk: {}, suratKeluar: {}, arsip: {}, peminjaman: {}, monthlyTrend: [] })
    mocks.report.getLendingReport.mockResolvedValue({ data: PINJAMAN, pagination: { page: 1, limit: 50, total: 2, totalPages: 1 } })
    mocks.report.exportReport.mockResolvedValue(undefined)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

describe('ekspor tab Peminjaman', () => {
    it('staf tidak melihat tombol ekspor', async () => {
        mocks.user = { id: 'staf', role: 'staff', unitKerjaId: 'unit-a' }
        render(<Laporan />)
        bukaTabPeminjaman()
        await screen.findByText('Sari')
        expect(screen.queryByRole('button', { name: 'Excel' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'PDF' })).toBeNull()
    })

    it.each(['admin_unit', 'admin_dirjen', 'auditor'])('%s melihat tombol Excel dan PDF', async (role) => {
        mocks.user = { id: 'pengguna', role, unitKerjaId: 'unit-a' }
        render(<Laporan />)
        bukaTabPeminjaman()
        await screen.findByText('Sari')
        expect(screen.getByRole('button', { name: 'Excel' })).toBeEnabled()
        expect(screen.getByRole('button', { name: 'PDF' })).toBeEnabled()
    })

    it('tabel menampilkan arsip atau boks yang dipinjam', async () => {
        render(<Laporan />)
        bukaTabPeminjaman()
        const barisArsip = (await screen.findByText('Sari')).closest('tr')
        expect(within(barisArsip).getByText('B-01/2026')).toBeInTheDocument()
        expect(within(barisArsip).getByText('Berkas pengadaan')).toBeInTheDocument()
        const barisBoks = screen.getByText('Budi').closest('tr')
        expect(within(barisBoks).getByText('Boks BX-7')).toBeInTheDocument()
        expect(within(barisBoks).getByText('Boks Keuangan')).toBeInTheDocument()
    })

    it('penyaring yang dikirim ke ekspor sama dengan penyaring tabel di layar', async () => {
        const { container } = render(<Laporan />)
        bukaTabPeminjaman()
        await screen.findByText('Sari')

        // Tanpa penyaring: semua status, tanpa tanggal, tanpa tahun.
        fireEvent.click(screen.getByRole('button', { name: 'Excel' }))
        await waitFor(() => expect(mocks.report.exportReport).toHaveBeenCalledTimes(1))
        expect(penyaringEkspor(0)).toEqual({ type: 'peminjaman', format: 'excel', params: { unitKerjaId: 'unit-a', status: 'all' } })
        expect(penyaringEkspor(0).params).toEqual(penyaringTabel())

        // Status Terlambat dan rentang tanggal pinjam.
        const [dari, sampai] = container.querySelectorAll('input[type="date"]')
        fireEvent.change(dari, { target: { value: '2026-09-01' } })
        fireEvent.change(sampai, { target: { value: '2026-09-30' } })
        const status = screen.getAllByRole('combobox', { name: 'Pilihan' }).find((pilihan) => within(pilihan).queryByRole('option', { name: 'Terlambat' }))
        fireEvent.change(status, { target: { value: 'overdue' } })
        await waitFor(() => expect(mocks.report.getLendingReport).toHaveBeenLastCalledWith(expect.objectContaining({
            status: 'overdue', tanggalDari: '2026-09-01', tanggalSampai: '2026-09-30',
        })))
        await waitFor(() => expect(screen.getByRole('button', { name: 'PDF' })).toBeEnabled())

        fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
        await waitFor(() => expect(mocks.report.exportReport).toHaveBeenCalledTimes(2))
        expect(penyaringEkspor(1)).toEqual({
            type: 'peminjaman', format: 'pdf',
            params: { unitKerjaId: 'unit-a', status: 'overdue', tanggalDari: '2026-09-01', tanggalSampai: '2026-09-30' },
        })
        expect(penyaringEkspor(1).params).toEqual(penyaringTabel())
        // Ekspor meminta seluruh hasil penyaring, bukan satu halaman.
        expect(mocks.report.exportReport.mock.calls[1][2]).not.toHaveProperty('page')
        expect(mocks.report.exportReport.mock.calls[1][2]).not.toHaveProperty('limit')
        expect(mocks.report.exportReport.mock.calls[1][2]).not.toHaveProperty('year')
    })

    it('penolakan server ditampilkan dengan pesannya', async () => {
        const pesan = 'Hasil filter berisi 10.001 rekod, melebihi batas ekspor 10.000. Persempit filter tahun, unit kerja, atau pencarian lalu ekspor kembali.'
        mocks.report.exportReport.mockRejectedValue(Object.assign(new Error(pesan), { status: 422 }))
        render(<Laporan />)
        bukaTabPeminjaman()
        await screen.findByText('Sari')
        fireEvent.click(screen.getByRole('button', { name: 'Excel' }))
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: pesan, variant: 'destructive' })))
        expect(screen.getByRole('button', { name: 'Excel' })).toBeEnabled()
    })
})
