import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from './Dashboard'
import dashboardService from '@/services/dashboard.service'

const mocks = vi.hoisted(() => ({ user: {}, charts: [] }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, canWrite: () => false }) }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: vi.fn(async () => []) } }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false, fileUploads: false } }) }))
vi.mock('react-router-dom', async importOriginal => ({ ...await importOriginal(), useNavigate: () => vi.fn() }))
vi.mock('react-chartjs-2', () => {
    const Chart = (props) => {
        mocks.charts.push(props)
        return <div role="img" aria-label={props['aria-label']} />
    }
    return { Line: Chart, Bar: Chart, Doughnut: Chart }
})
vi.mock('@/services/dashboard.service', () => ({ default: {
    getStats: vi.fn(async () => ({ totalMasuk: 0, totalKeluar: 0, totalArsip: 0, monthlyTrend: [] })),
    getExpiringArchives: vi.fn(async () => []),
    getUnitKerjaComparison: vi.fn(async () => []),
    getRecentActivity: vi.fn(async () => []),
    getWidgetData: vi.fn(async () => null),
} }))

const LABEL_GRAFIK = 'Grafik volume surat per unit kerja pada tahun 2026'

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.charts.length = 0
    mocks.user = { id: 'super', name: 'Siti', role: 'super_admin' }
    dashboardService.getUnitKerjaComparison.mockReset().mockResolvedValue([
        { name: 'Ditjen PTPP', masuk: 1, keluar: 0, arsip: 0 },
        { name: 'Sekretariat Ditjen', masuk: 3, keluar: 1, arsip: 1 },
        { name: 'Direktorat BPPT', masuk: 5, keluar: 0, arsip: 0 },
    ])
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-09T03:00:00Z'))
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('grafik Perbandingan Unit Kerja', () => {
    it('berlabel tahun yang sama dengan tahun yang diminta, bukan bulan ini', async () => {
        render(<MemoryRouter><Dashboard /></MemoryRouter>)
        expect(await screen.findByRole('img', { name: LABEL_GRAFIK })).toBeInTheDocument()
        expect(screen.getByText('Volume surat per unit kerja tahun ini (2026)')).toBeInTheDocument()
        expect(screen.queryByText(/per unit kerja bulan ini/)).not.toBeInTheDocument()
        expect(dashboardService.getUnitKerjaComparison).toHaveBeenCalledWith(null, 2026)
    })

    it('Semua Unit Kerja menampilkan setiap unit dari server sesuai urutannya', async () => {
        render(<MemoryRouter><Dashboard /></MemoryRouter>)
        await screen.findByRole('img', { name: LABEL_GRAFIK })
        await waitFor(() => {
            const grafik = mocks.charts.filter((props) => props['aria-label'] === LABEL_GRAFIK).at(-1)
            expect(grafik.data.labels).toEqual(['Ditjen PTPP', 'Sekretariat Ditjen', 'BPPT'])
            expect(grafik.data.datasets.map((dataset) => dataset.data)).toEqual([[1, 3, 5], [0, 1, 0]])
        })
    })
})
