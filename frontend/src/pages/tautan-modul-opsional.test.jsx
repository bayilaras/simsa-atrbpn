import { Suspense } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import UserGuide from './UserGuide'
import FormulirIndex from './Formulir/Index'
import FormulirViewer from './Formulir/FormulirViewer'
import Dashboard from './Dashboard'
import RetentionManagement from './RetentionManagement'

const state = vi.hoisted(() => ({ capabilities: {}, navigate: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({
    user: { id: 'operator', name: 'Siti', role: 'admin_unit', unitKerjaId: 'unit-a' }, canWrite: () => true }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ loading: false, compatible: true,
    capabilities: state.capabilities, features: {}, authentication: {} }) }))
vi.mock('react-router-dom', async importOriginal => ({ ...await importOriginal(), useNavigate: () => state.navigate }))
vi.mock('react-chartjs-2', () => ({ Line: () => null, Bar: () => null, Doughnut: () => null }))
vi.mock('@/hooks/use-persetujuan-menunggu-count', () => ({ usePersetujuanMenungguCount: () => ({ total: 0 }) }))
vi.mock('@/components/formulir/Formulir13', () => ({ default: () => <h1>Template pemindahan arsip</h1> }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: vi.fn(async () => []) } }))
vi.mock('@/services/dashboard.service', () => ({ default: {
    getStats: vi.fn(async () => ({ totalMasuk: 0, totalKeluar: 0, totalArsip: 0, monthlyTrend: [] })),
    getExpiringArchives: vi.fn(async () => []), getUnitKerjaComparison: vi.fn(async () => []), getRecentActivity: vi.fn(async () => []),
    getWidgetData: vi.fn(async () => ({ archiveLifecycle: {}, storageCapacity: [], lendingOverview: {}, mediaBreakdown: [],
        penyusutanOverview: [{ status: 'proposed', count: 2 }],
        vitalTerjagaAlerts: { vitalTotal: 1, vitalUnprotected: 0, terjagaTotal: 1, terjagaUnreported: 0, terjagaReportingStages: {} } })),
} }))
vi.mock('@/services/retention.service', () => ({ default: {
    getSummary: vi.fn(async () => ({ data: { alertLevel: 'none' } })),
    getCandidates: vi.fn(async () => ({ data: [], summary: {}, pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } })),
    getHolds: vi.fn(async () => ({ data: [] })),
} }))
vi.mock('@/hooks/use-required-unit-kerja-scope', () => ({ useRequiredUnitKerjaScope: () => ({ unitKerjaId: 'unit-a', loading: false }) }))
vi.mock('@/components/RequiredUnitKerjaScope', () => ({ RequiredUnitKerjaScope: () => null }))

const OFF = { metadata: true, files: true, fileUploads: true, externalIntegrations: true, bulkOcr: false, advancedArchiveWorkflows: false }
const ON = { ...OFF, bulkOcr: true, advancedArchiveWorkflows: true }
const show = (element, path = '/') => render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>)

beforeEach(() => {
    state.capabilities = { ...OFF }
    state.navigate.mockReset()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('tautan ke modul opsional yang dimatikan', () => {
    it('panduan mengarahkan penyusutan ke Manajemen Retensi selama modulnya mati', () => {
        const page = show(<UserGuide />)
        const card = document.getElementById('penyusutan-penyerahan')
        expect(within(card).queryByRole('link', { name: /Buka Penyusutan/ })).not.toBeInTheDocument()
        expect(within(card).getByRole('link', { name: /Buka Manajemen Retensi/ })).toHaveAttribute('href', '/retention')
        expect(within(card).getAllByText(/dilakukan di luar SIMSA/).length).toBeGreaterThan(0)
        expect(screen.queryByText(/staf membaca data/)).not.toBeInTheDocument()

        state.capabilities = { ...ON }
        page.rerender(<MemoryRouter><UserGuide /></MemoryRouter>)
        const enabledCard = document.getElementById('penyusutan-penyerahan')
        expect(within(enabledCard).getByRole('link', { name: /Buka Penyusutan/ })).toHaveAttribute('href', '/penyusutan')
        expect(within(enabledCard).queryByText(/dilakukan di luar SIMSA/)).not.toBeInTheDocument()
    })

    it('daftar formulir menampilkan semua template; tombol hanya untuk formulir yang dibuat dari data aplikasi', () => {
        const page = show(<FormulirIndex />)
        const periksa = () => {
            expect(screen.getAllByRole('button', { name: 'Lihat Template Kosong' })).toHaveLength(33)
            expect(screen.getAllByRole('link', { name: 'Ekspor dari Arsip' })).toHaveLength(2)
            expect(screen.getByRole('link', { name: 'Buka Arsip Vital' })).toHaveAttribute('href', '/arsip-vital')
            expect(screen.getAllByText('Diisi manual dari template')).toHaveLength(30)
            for (const nama of ['Buka Penyusutan', 'Buka Arsip Terjaga', 'Buka Peminjaman', 'Buka Laporan', 'Buka Tunjuk Silang']) {
                expect(screen.queryByRole('link', { name: nama })).not.toBeInTheDocument()
            }
            expect(screen.queryByText(/belum diaktifkan/)).not.toBeInTheDocument()
        }
        periksa()

        // Modul opsional yang menyala tidak menambah tautan ke Penyusutan atau Arsip Terjaga.
        state.capabilities = { ...ON }
        page.rerender(<MemoryRouter><FormulirIndex /></MemoryRouter>)
        periksa()
    })

    it('pratinjau formulir tetap dapat dicetak tanpa tautan ke Penyusutan', async () => {
        const viewer = () => (
            <MemoryRouter initialEntries={['/formulir/cetak/13']}>
                <Suspense fallback={null}><Routes><Route path="/formulir/cetak/:id" element={<FormulirViewer />} /></Routes></Suspense>
            </MemoryRouter>
        )
        const page = render(viewer())
        expect(await screen.findByRole('heading', { name: 'Template pemindahan arsip' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Cetak Template Kosong' })).toBeInTheDocument()
        expect(screen.queryByRole('link', { name: 'Buka Penyusutan' })).not.toBeInTheDocument()

        state.capabilities = { ...ON }
        page.rerender(viewer())
        expect(screen.queryByRole('link', { name: 'Buka Penyusutan' })).not.toBeInTheDocument()
    })

    it('dashboard menyembunyikan pipeline penyusutan dan ringkasan arsip terjaga', async () => {
        const page = show(<Dashboard />)
        expect(await screen.findByText('Kapasitas Penyimpanan Fisik')).toBeInTheDocument()
        // Judul kartu dan blok isinya sama-sama "Arsip Vital"; arsip vital bukan modul opsional.
        expect(screen.getAllByText('Arsip Vital')).toHaveLength(2)
        expect(screen.queryByText('Pipeline Penyusutan Arsip')).not.toBeInTheDocument()
        expect(screen.queryByRole('region', { name: 'Pelaporan arsip terjaga' })).not.toBeInTheDocument()
        expect(screen.queryByText('Arsip Vital & Terjaga')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Unggah Massal' })).not.toBeInTheDocument()

        state.capabilities = { ...ON }
        page.rerender(<MemoryRouter><Dashboard /></MemoryRouter>)
        expect(screen.getByText('Pipeline Penyusutan Arsip')).toBeInTheDocument()
        expect(screen.getByText('Arsip Vital & Terjaga')).toBeInTheDocument()
        expect(screen.getByRole('region', { name: 'Pelaporan arsip terjaga' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Lihat pelaporan arsip terjaga' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Unggah Massal' })).toBeInTheDocument()
    })

    it('manajemen retensi memberi catatan penyusutan di luar SIMSA hanya saat modulnya mati', async () => {
        const note = /Selama modul Penyusutan belum diaktifkan/
        const page = show(<RetentionManagement />)
        expect(await screen.findByText('Daftar Kandidat Penyusutan')).toBeInTheDocument()
        expect(screen.getByText(note)).toBeInTheDocument()
        expect(screen.queryByRole('link', { name: /Penyusutan/ })).not.toBeInTheDocument()

        state.capabilities = { ...ON }
        page.rerender(<MemoryRouter><RetentionManagement /></MemoryRouter>)
        expect(screen.queryByText(note)).not.toBeInTheDocument()
    })
})
