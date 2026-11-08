import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Laporan from './Laporan'

const mocks = vi.hoisted(() => ({
    user: { id: 'reader', role: 'staff', unitKerjaId: 'unit-a' },
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

const TOTAL = 120
const halaman = (prefix) => async ({ page = 1, limit = 50 } = {}) => ({
    data: [1, 2].map((n) => {
        const penanda = `${prefix}-${page}-${n}`
        return { id: penanda, nomorSurat: penanda, nomorBerkas: penanda, borrowerName: penanda }
    }),
    pagination: { page, limit, total: TOTAL, totalPages: Math.ceil(TOTAL / limit) },
})

function bukaTab(name) {
    fireEvent.mouseDown(screen.getByRole('tab', { name, exact: true }), { button: 0, ctrlKey: false })
}

const navigasi = (label) => screen.getByRole('navigation', { name: `Halaman ${label}` })

beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = { id: 'reader', role: 'staff', unitKerjaId: 'unit-a' }
    mocks.report.getSummaryReport.mockResolvedValue({ suratMasuk: {}, suratKeluar: {}, arsip: {}, peminjaman: {}, monthlyTrend: [] })
    mocks.report.getSuratMasukReport.mockImplementation(halaman('SM'))
    mocks.report.getSuratKeluarReport.mockImplementation(halaman('SK'))
    mocks.report.getArsipReport.mockImplementation(halaman('AR'))
    mocks.report.getLendingReport.mockImplementation(halaman('PJ'))
    mocks.report.exportReport.mockResolvedValue(undefined)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

describe('paginasi tabel Laporan', () => {
    it('surat masuk berpindah ke halaman berikutnya dan kembali ke halaman 1 saat filter berubah', async () => {
        const { container } = render(<Laporan />)
        bukaTab('Surat Masuk')

        expect(await screen.findByText('SM-1-1')).toBeInTheDocument()
        expect(mocks.report.getSuratMasukReport).toHaveBeenLastCalledWith(expect.objectContaining({ unitKerjaId: 'unit-a', page: 1, limit: 50 }))
        expect(within(navigasi('laporan surat masuk')).getByRole('status')).toHaveTextContent('120 data · Halaman 1 dari 3')

        fireEvent.click(within(navigasi('laporan surat masuk')).getByRole('button', { name: 'Berikutnya' }))
        const barisKedua = await screen.findByText('SM-2-1')
        expect(mocks.report.getSuratMasukReport).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 50 }))
        expect(within(barisKedua.closest('tr')).getByText('51')).toBeInTheDocument()
        expect(within(navigasi('laporan surat masuk')).getByRole('status')).toHaveTextContent('Halaman 2 dari 3')

        const [dariTanggal] = container.querySelectorAll('input[type="date"]')
        fireEvent.change(dariTanggal, { target: { value: '2026-02-01' } })
        expect(await screen.findByText('SM-1-1')).toBeInTheDocument()
        expect(mocks.report.getSuratMasukReport).toHaveBeenLastCalledWith(expect.objectContaining({ tanggalDari: '2026-02-01', page: 1, limit: 50 }))
    })

    it.each([
        ['Surat Keluar', 'laporan surat keluar', 'getSuratKeluarReport', 'SK-2-1'],
        ['Arsip', 'laporan arsip', 'getArsipReport', 'AR-2-1'],
        ['Peminjaman', 'laporan peminjaman', 'getLendingReport', 'PJ-2-1'],
    ])('tab %s meminta halaman 2 dari server', async (tab, label, method, penanda) => {
        render(<Laporan />)
        bukaTab(tab)
        await waitFor(() => expect(mocks.report[method]).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, limit: 50 })))
        await waitFor(() => expect(within(navigasi(label)).getByRole('status')).toHaveTextContent('120 data · Halaman 1 dari 3'))

        fireEvent.click(within(navigasi(label)).getByRole('button', { name: 'Berikutnya' }))
        await waitFor(() => expect(mocks.report[method]).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 50 })))
        await waitFor(() => expect(within(navigasi(label)).getByRole('status')).toHaveTextContent('Halaman 2 dari 3'))
        expect(screen.getAllByText(penanda).length).toBeGreaterThan(0)
    })

    it('ekspor dari halaman 2 tetap meminta seluruh hasil filter tanpa page atau limit', async () => {
        mocks.user = { id: 'admin', role: 'admin_unit', unitKerjaId: 'unit-a' }
        render(<Laporan />)
        bukaTab('Surat Masuk')
        await screen.findByText('SM-1-1')
        fireEvent.click(within(navigasi('laporan surat masuk')).getByRole('button', { name: 'Berikutnya' }))
        await screen.findByText('SM-2-1')

        fireEvent.click(screen.getByRole('button', { name: 'Excel' }))
        await waitFor(() => expect(mocks.report.exportReport).toHaveBeenCalledTimes(1))
        const [type, format, params] = mocks.report.exportReport.mock.calls[0]
        expect([type, format]).toEqual(['surat-masuk', 'excel'])
        expect(params).toMatchObject({ unitKerjaId: 'unit-a' })
        expect(params).not.toHaveProperty('page')
        expect(params).not.toHaveProperty('limit')
    })
})
