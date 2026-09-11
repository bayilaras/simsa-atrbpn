import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from './Dashboard'
import dashboardService from '@/services/dashboard.service'

const mocks = vi.hoisted(() => ({ user: {}, navigate: vi.fn(), widgets: {}, motionChanged: null }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user,
    canWrite: () => ['super_admin', 'admin_dirjen', 'admin_sesditjen'].includes(mocks.user.role) }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false, fileUploads: false } }) }))
vi.mock('react-router-dom', async importOriginal => ({ ...await importOriginal(), useNavigate: () => mocks.navigate }))
vi.mock('react-chartjs-2', () => {
    const Chart = ({ options }) => <div data-testid="chart" data-animation={String(options.animation)} />
    return { Line: Chart, Bar: Chart, Doughnut: Chart }
})
vi.mock('@/services/dashboard.service', () => ({ default: {
    getStats: vi.fn(async () => ({ totalMasuk: 0, totalKeluar: 0, totalArsip: 0, monthlyTrend: [] })),
    getExpiringArchives: vi.fn(async () => []), getUnitKerjaComparison: vi.fn(async () => []),
    getRecentActivity: vi.fn(async () => []), getWidgetData: vi.fn(async () => mocks.widgets),
} }))

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    dashboardService.getStats.mockReset().mockResolvedValue({ totalMasuk: 0, totalKeluar: 0, totalArsip: 0, monthlyTrend: [] })
    dashboardService.getWidgetData.mockReset().mockImplementation(async () => mocks.widgets)
    mocks.user = { id: 'reader', name: 'Siti', role: 'staff', unitKerjaId: 'unit-a' }
    mocks.navigate.mockReset()
    mocks.widgets = { archiveLifecycle: {}, storageCapacity: [], lendingOverview: {}, penyusutanOverview: [], mediaBreakdown: [],
        vitalTerjagaAlerts: { vitalTotal: 0, vitalUnprotected: 0, terjagaTotal: 1, terjagaUnreported: 0,
            terjagaReportingStages: { belum_dilaporkan: 0, dicatat: 1, dikirim: 0, diterima: 0, bukti_diverifikasi: 0, perlu_ditinjau: 0 } } }
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true,
        addEventListener: (_event, callback) => { mocks.motionChanged = callback }, removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function show() { render(<MemoryRouter><Dashboard /></MemoryRouter>); await screen.findByRole('heading', { name: 'Halo, Siti' }) }

describe('dashboard daily workflow', () => {
    it.each(['staff', 'auditor'])('gives %s a primary archive action without inaccessible management links', async role => {
        mocks.user.role = role
        await show()
        const actions = screen.getByRole('region', { name: 'Tindakan utama' })
        fireEvent.click(within(actions).getByRole('button', { name: 'Cari Arsip' }))
        expect(mocks.navigate).toHaveBeenCalledWith('/arsip/masuk')
        expect(screen.queryByRole('button', { name: /Catat Surat/ })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /Lihat Semua Jadwal Retensi|Kelola Penyimpanan/ })).not.toBeInTheDocument()
        const chartHeading = screen.getByText('Analisis Tren Surat')
        expect(actions.compareDocumentPosition(chartHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
    it('labels admin creation actions explicitly and puts them before analytics', async () => {
        mocks.user.role = 'admin_dirjen'
        await show()
        const actions = screen.getByRole('region', { name: 'Tindakan utama' })
        fireEvent.click(within(actions).getByRole('button', { name: 'Catat Surat Masuk' }))
        expect(mocks.navigate).toHaveBeenCalledWith('/surat/masuk/tambah')
        expect(within(actions).getByRole('button', { name: 'Catat Surat Keluar' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Kelola Penyimpanan' })).toBeInTheDocument()
    })
    it('does not infer a draft or completed reporting from the recorded status', async () => {
        await show()
        const reporting = screen.getByRole('region', { name: 'Pelaporan arsip terjaga' })
        expect(within(reporting).getByText('Dicatat; pelaporan perlu ditinjau').parentElement).toHaveTextContent('1')
        expect(within(reporting).queryByText('Draf laporan')).not.toBeInTheDocument()
        expect(within(reporting).getByText('Bukti diverifikasi internal').parentElement).toHaveTextContent('0')
        expect(screen.queryByText(/sudah dilaporkan ke ANRI/)).not.toBeInTheDocument()
    })
    it('disables every Chart.js animation and follows changes to reduced motion', async () => {
        await show()
        for (const chart of screen.getAllByTestId('chart')) expect(chart).toHaveAttribute('data-animation', 'false')
        act(() => mocks.motionChanged({ matches: false }))
        for (const chart of screen.getAllByTestId('chart')) expect(chart).not.toHaveAttribute('data-animation', 'false')
    })
    it('does not allow a delayed refresh for unit A to overwrite the loaded unit B', async () => {
        dashboardService.getStats.mockResolvedValue({ totalMasuk: 101, totalKeluar: 0, totalArsip: 0, monthlyTrend: [] })
        const page = render(<MemoryRouter><Dashboard /></MemoryRouter>)
        await screen.findByRole('heading', { name: 'Halo, Siti' })
        let resolveOld
        let resolveNew
        dashboardService.getStats.mockImplementation(unit => unit === 'unit-a'
            ? new Promise(resolve => { resolveOld = resolve })
            : new Promise(resolve => { resolveNew = resolve }))
        fireEvent.focus(window)
        await waitFor(() => expect(resolveOld).toBeTypeOf('function'))
        mocks.user = { ...mocks.user, unitKerjaId: 'unit-b' }
        page.rerender(<MemoryRouter><Dashboard /></MemoryRouter>)
        await waitFor(() => expect(resolveNew).toBeTypeOf('function'))
        expect(screen.queryByText('101')).not.toBeInTheDocument()
        await act(async () => resolveNew({ totalMasuk: 202, totalKeluar: 0, totalArsip: 0, monthlyTrend: [] }))
        expect(await screen.findByText('202')).toBeInTheDocument()
        await act(async () => resolveOld({ totalMasuk: 303, totalKeluar: 0, totalArsip: 0, monthlyTrend: [] }))
        expect(screen.queryByText('303')).not.toBeInTheDocument()
        expect(screen.getByText('202')).toBeInTheDocument()
    })
    it('shows a widget load failure and retries without claiming missing widgets are healthy', async () => {
        dashboardService.getWidgetData.mockRejectedValueOnce(new Error('widgets offline'))
        await show()
        expect(screen.getByRole('alert')).toHaveTextContent('Ringkasan tambahan belum tersedia')
        expect(screen.queryByRole('region', { name: 'Pelaporan arsip terjaga' })).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi memuat ringkasan' }))
        expect(await screen.findByRole('region', { name: 'Pelaporan arsip terjaga' })).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
    it('labels previous data after a failed background refresh and offers retry', async () => {
        dashboardService.getStats.mockResolvedValue({ totalMasuk: 101, totalKeluar: 0, totalArsip: 0, monthlyTrend: [] })
        await show()
        dashboardService.getStats.mockRejectedValueOnce(new Error('offline'))
        fireEvent.focus(window)
        expect(await screen.findByRole('alert')).toHaveTextContent('Data terakhir')
        expect(screen.getByText('101')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi memuat ringkasan' }))
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    })
});
