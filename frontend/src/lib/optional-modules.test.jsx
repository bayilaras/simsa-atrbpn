import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { createAppConfig, resolveRuntimeCapabilities } from './app-config'
import App from '@/App'
import Dashboard from '@/pages/Dashboard'
import Arsip from '@/pages/Arsip'
import ArsipElektronikDetail from '@/pages/ArsipElektronik/ArsipElektronikDetail'
import { AppSidebar } from '@/components/app-sidebar'
import { SidebarProvider } from '@/components/ui/sidebar'

const state = vi.hoisted(() => ({ path: '/', capabilities: {}, loading: false, navigate: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, loading: false,
    user: { id: 'operator', name: 'Siti', role: 'admin_dirjen', unitKerjaId: 'unit-a' }, canWrite: () => true }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ loading: state.loading, compatible: true,
    capabilities: state.capabilities, features: {}, authentication: {}, mode: 'full' }) }))
vi.mock('react-router-dom', async importOriginal => {
    const actual = await importOriginal()
    function TestRoutes({ routes }) { return actual.useRoutes(routes) }
    return { ...actual, useNavigate: () => state.navigate, createBrowserRouter: routes => routes,
        RouterProvider: ({ router }) => <actual.MemoryRouter initialEntries={[state.path]}><TestRoutes routes={router} /></actual.MemoryRouter> }
})
vi.mock('@/components/ProvisionedAccessGate', () => ({ ProvisionedAccessGate: ({ children }) => children }))
vi.mock('@/components/app-header', () => ({ AppHeader: () => null }))
vi.mock('@/components/IdleWarningBanner', () => ({ IdleWarningBanner: () => null }))
vi.mock('@/components/OfflineIndicator', () => ({ OfflineIndicator: () => null }))
vi.mock('@/components/AppServiceNotice', () => ({ AppServiceNotice: () => null }))
vi.mock('@/pages/Login', () => ({ default: () => null }))
vi.mock('@/pages/BulkUpload', () => ({ default: () => <h1>Bulk module mounted</h1> }))
vi.mock('@/pages/PenyusutanArsip', () => ({ default: () => <h1>Disposal module mounted</h1> }))
vi.mock('@/pages/ArsipTerjaga', () => ({ default: () => <h1>Reporting module mounted</h1> }))
vi.mock('@/pages/ArsipElektronik', () => ({ default: () => <h1>Manual electronic archive mounted</h1> }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ImportCsvDialog', () => ({ default: () => null }))
vi.mock('@/components/ArchiveLifecycleWidget', () => ({ ArchiveLifecycleWidget: () => null }))
vi.mock('react-chartjs-2', () => ({ Line: () => null, Bar: () => null, Doughnut: () => null }))
vi.mock('@/services/arsip.service', () => ({ arsipService: {
    getAll: vi.fn(async () => ({ data: [], pagination: { total: 0 } })),
    getStats: vi.fn(async () => ({ total: 0, arsipMasuk: 0, arsipKeluar: 0 })),
} }))
vi.mock('@/services/dashboard.service', () => ({ default: {
    getStats: vi.fn(async () => ({ totalMasuk: 0, totalKeluar: 0, totalArsip: 0, monthlyTrend: [] })),
    getExpiringArchives: vi.fn(async () => []), getUnitKerjaComparison: vi.fn(async () => []), getRecentActivity: vi.fn(async () => []),
    getWidgetData: vi.fn(async () => ({ archiveLifecycle: {}, storageCapacity: [], lendingOverview: {}, penyusutanOverview: [], mediaBreakdown: [],
        vitalTerjagaAlerts: { vitalTotal: 0, vitalUnprotected: 0, terjagaTotal: 1, terjagaUnreported: 0, terjagaReportingStages: {} } })),
} }))
vi.mock('@/components/arsip-elektronik/PreservationActionForm', () => ({ default: () => <button>Preservation form mounted</button> }))
vi.mock('@/components/arsip-elektronik/PreservationHistory', () => ({ default: () => <p>Preservation history mounted</p> }))

beforeEach(() => {
    state.capabilities = { metadata: true, files: true, fileUploads: true, externalIntegrations: true, bulkOcr: false, advancedArchiveWorkflows: false }
    state.loading = false
    state.navigate.mockReset()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('optional module capability contract', () => {
    it('normalizes backend restrictions independently from manual file availability and legacy defaults', () => {
        const payload = { mode: 'full', syntheticDataOnly: false, capabilities: state.capabilities }
        const build = createAppConfig({})
        expect(build.capabilities).toMatchObject({ bulkOcr: true, advancedArchiveWorkflows: true })
        expect(resolveRuntimeCapabilities(build, payload).capabilities).toMatchObject({ files: true, fileUploads: true, bulkOcr: false, advancedArchiveWorkflows: false })
        const legacy = { metadata: true, files: true, fileUploads: true, externalIntegrations: true }
        expect(resolveRuntimeCapabilities(build, { ...payload, capabilities: legacy }).capabilities).toMatchObject({ bulkOcr: true, advancedArchiveWorkflows: true })
        expect(resolveRuntimeCapabilities(build, { ...payload, capabilities: { ...legacy, bulkOcr: 'true', advancedArchiveWorkflows: null } }).capabilities)
            .toMatchObject({ bulkOcr: false, advancedArchiveWorkflows: false })
        expect(resolveRuntimeCapabilities(build, null).capabilities).toMatchObject({ bulkOcr: false, advancedArchiveWorkflows: false })
    })

    it.each(['/bulk-upload', '/penyusutan', '/arsip-terjaga'])('denies direct UI route %s without mounting the module', async path => {
        state.path = path
        render(<App />)
        expect(await screen.findByRole('heading', { name: 'Modul belum diaktifkan' })).toBeInTheDocument()
        expect(screen.queryByRole('heading', { name: /module mounted/ })).not.toBeInTheDocument()
    })

    it.each([['/bulk-upload', 'Bulk module mounted'], ['/penyusutan', 'Disposal module mounted'], ['/arsip-terjaga', 'Reporting module mounted']])('retains enabled route %s', async (path, title) => {
        state.capabilities.bulkOcr = true
        state.capabilities.advancedArchiveWorkflows = true
        state.path = path
        render(<App />)
        expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    })

    it('keeps manual electronic archive routes available', async () => {
        state.path = '/arsip-elektronik'
        render(<App />)
        expect(await screen.findByRole('heading', { name: 'Manual electronic archive mounted' })).toBeInTheDocument()
    })

    it('removes advanced sidebar links while retaining manual archives and governance', () => {
        const page = render(<MemoryRouter><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter>)
        expect(screen.queryByRole('link', { name: 'Penyusutan' })).not.toBeInTheDocument()
        expect(screen.queryByRole('link', { name: 'Arsip Terjaga' })).not.toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Arsip Elektronik' })).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Tata Kelola Retensi' })).toBeInTheDocument()
        state.capabilities.advancedArchiveWorkflows = true
        page.rerender(<MemoryRouter><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter>)
        expect(screen.getByRole('link', { name: 'Penyusutan' })).toBeInTheDocument()
    })

    it('hides bulk and reporting dashboard actions but keeps manual letter actions', async () => {
        const page = render(<MemoryRouter><Dashboard /></MemoryRouter>)
        await screen.findByRole('heading', { name: 'Halo, Siti' })
        expect(screen.queryByRole('button', { name: 'Unggah Massal' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Lihat pelaporan arsip terjaga' })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Catat Surat Masuk' })).toBeInTheDocument()
        state.capabilities.bulkOcr = true
        state.capabilities.advancedArchiveWorkflows = true
        page.rerender(<MemoryRouter><Dashboard /></MemoryRouter>)
        expect(screen.getByRole('button', { name: 'Unggah Massal' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Lihat pelaporan arsip terjaga' })).toBeInTheDocument()
    })

    it('hides the archive bulk action while retaining the manual archive list', async () => {
        const page = render(<MemoryRouter><Arsip /></MemoryRouter>)
        await screen.findByText('Belum ada data arsip keluar')
        expect(screen.queryByRole('link', { name: 'Unggah Massal' })).not.toBeInTheDocument()
        state.capabilities.bulkOcr = true
        page.rerender(<MemoryRouter><Arsip /></MemoryRouter>)
        expect(screen.getByRole('link', { name: 'Unggah Massal' })).toBeInTheDocument()
    })

    it('does not mount preservation controls when disabled, including after a capability refresh', async () => {
        const props = { open: true, onOpenChange: vi.fn(), selectedItem: { id: 'archive', formatFile: 'PDF', qcStatus: 'passed' }, verifyNote: '', setVerifyNote: vi.fn(), onVerify: vi.fn() }
        const page = render(<ArsipElektronikDetail {...props} />)
        expect(screen.getByRole('button', { name: 'Verifikasi' })).toBeEnabled()
        expect(screen.queryByRole('tab', { name: 'Preservasi Digital' })).not.toBeInTheDocument()
        state.capabilities.advancedArchiveWorkflows = true
        page.rerender(<ArsipElektronikDetail {...props} />)
        fireEvent.mouseDown(screen.getByRole('tab', { name: 'Preservasi Digital' }), { button: 0, ctrlKey: false })
        await waitFor(() => expect(screen.getByText('Preservation form mounted')).toBeInTheDocument())
        state.capabilities.advancedArchiveWorkflows = false
        page.rerender(<ArsipElektronikDetail {...props} />)
        expect(screen.queryByText('Preservation form mounted')).not.toBeInTheDocument()
        expect(screen.queryByText('Preservation history mounted')).not.toBeInTheDocument()
    })
})
