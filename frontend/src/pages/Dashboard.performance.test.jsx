import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from './Dashboard'
import dashboardService from '@/services/dashboard.service'

const metrics = vi.hoisted(() => ({
    stats: { totalMasuk: 0, totalKeluar: 0, totalArsip: 0, monthlyTrend: [] },
    widgets: { archiveLifecycle: {}, storageCapacity: [], lendingOverview: {}, penyusutanOverview: [], mediaBreakdown: [],
        vitalTerjagaAlerts: { vitalTotal: 0, vitalUnprotected: 0, terjagaTotal: 0, terjagaUnreported: 0,
            terjagaReportingStages: {} } },
    user: { id: 'performance-reader', name: 'Siti', role: 'staff', unitKerjaId: 'unit-a' },
}))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: metrics.user, canWrite: () => false }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false, fileUploads: false } }) }))
vi.mock('react-chartjs-2', () => ({ Line: () => null, Bar: () => null, Doughnut: () => null }))
vi.mock('@/services/dashboard.service', () => ({ default: {
    getStats: vi.fn(), getExpiringArchives: vi.fn(), getUnitKerjaComparison: vi.fn(),
    getRecentActivity: vi.fn(), getWidgetData: vi.fn(),
} }))

const endpointNames = ['getStats', 'getExpiringArchives', 'getUnitKerjaComparison', 'getRecentActivity', 'getWidgetData']
const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState')

beforeEach(() => {
    vi.clearAllMocks()
    metrics.user = { id: 'performance-reader', name: 'Siti', role: 'staff', unitKerjaId: 'unit-a' }
    dashboardService.getStats.mockResolvedValue(metrics.stats)
    dashboardService.getExpiringArchives.mockResolvedValue([])
    dashboardService.getUnitKerjaComparison.mockResolvedValue([])
    dashboardService.getRecentActivity.mockResolvedValue([])
    dashboardService.getWidgetData.mockResolvedValue(metrics.widgets)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})

afterEach(() => {
    cleanup()
    if (visibilityDescriptor) Object.defineProperty(document, 'visibilityState', visibilityDescriptor)
    else delete document.visibilityState
    vi.unstubAllGlobals()
})

async function showDashboard() {
    const page = render(<MemoryRouter><Dashboard /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Halo, Siti' })
    for (const name of endpointNames) expect(dashboardService[name]).toHaveBeenCalledTimes(1)
    return page
}

describe('dashboard refresh request coalescing', () => {
    it('shares one five-endpoint load for focus and visible events while a refresh is pending', async () => {
        await showDashboard()
        let finishStats
        dashboardService.getStats.mockImplementationOnce(() => new Promise(resolve => { finishStats = resolve }))
        act(() => {
            window.dispatchEvent(new Event('focus'))
            document.dispatchEvent(new Event('visibilitychange'))
        })
        await waitFor(() => expect(finishStats).toBeTypeOf('function'))
        const counts = Object.fromEntries(endpointNames.map(name => [name, dashboardService[name].mock.calls.length - 1]))
        try {
            expect(counts).toEqual(Object.fromEntries(endpointNames.map(name => [name, 1])))
        } finally {
            await act(async () => finishStats({ ...metrics.stats, totalMasuk: 73 }))
        }
        expect(await screen.findByText('73')).toBeInTheDocument()
    })

    it('starts a fresh load on the next focus after the previous refresh completed', async () => {
        await showDashboard()
        dashboardService.getStats.mockResolvedValueOnce({ ...metrics.stats, totalMasuk: 81 })
        fireEvent.focus(window)
        expect(await screen.findByText('81')).toBeInTheDocument()
        dashboardService.getStats.mockResolvedValueOnce({ ...metrics.stats, totalMasuk: 82 })
        fireEvent.focus(window)
        expect(await screen.findByText('82')).toBeInTheDocument()
        for (const name of endpointNames) expect(dashboardService[name]).toHaveBeenCalledTimes(3)
    })

    it.each(['user', 'unit'])('keeps a new %s request separate when an older scope finishes', async changedScope => {
        const page = await showDashboard()
        let finishOld
        let finishCurrent
        dashboardService.getStats
            .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
            .mockImplementationOnce(() => new Promise(resolve => { finishCurrent = resolve }))
        fireEvent.focus(window)
        metrics.user = changedScope === 'user'
            ? { ...metrics.user, id: 'another-reader' }
            : { ...metrics.user, unitKerjaId: 'unit-b' }
        page.rerender(<MemoryRouter><Dashboard /></MemoryRouter>)
        await waitFor(() => expect(finishCurrent).toBeTypeOf('function'))
        await act(async () => finishOld({ ...metrics.stats, totalMasuk: 91 }))
        expect(screen.queryByText('91')).not.toBeInTheDocument()
        act(() => {
            window.dispatchEvent(new Event('focus'))
            document.dispatchEvent(new Event('visibilitychange'))
        })
        try {
            for (const name of endpointNames) expect(dashboardService[name]).toHaveBeenCalledTimes(3)
            expect(dashboardService.getStats).toHaveBeenLastCalledWith(changedScope === 'user' ? 'unit-a' : 'unit-b')
        } finally {
            await act(async () => finishCurrent({ ...metrics.stats, totalMasuk: 92 }))
        }
        expect(await screen.findByText('92')).toBeInTheDocument()
    })
})
