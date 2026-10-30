import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Chart as ChartJS } from 'chart.js'
import Laporan from './Laporan'

const chart = vi.hoisted(() => ({ props: null }))

vi.mock('react-chartjs-2', () => ({
    Bar: (props) => {
        chart.props = props
        return <canvas data-testid="monthly-chart" />
    },
}))
vi.mock('@/context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'reader', role: 'staff', unitKerjaId: 'unit-a' } }),
}))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/services/report.service', () => ({ reportService: {
    getSummaryReport: vi.fn(async () => ({
        suratMasuk: { total: 3 }, suratKeluar: { total: 1 }, arsip: { total: 0 }, peminjaman: { total: 0 },
        monthlyTrend: [{ month: 'Jan', masuk: 3, keluar: 1 }, { month: 'Feb', masuk: 0, keluar: 0 }],
    })),
} }))

beforeEach(() => {
    chart.props = null
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

describe('Laporan monthly chart', () => {
    it('registers its own chart.js pieces so it works as the first chart page', () => {
        expect(() => ChartJS.registry.getElement('bar')).not.toThrow()
        expect(() => ChartJS.registry.getScale('category')).not.toThrow()
        expect(() => ChartJS.registry.getScale('linear')).not.toThrow()
        expect(() => ChartJS.registry.getPlugin('tooltip')).not.toThrow()
        expect(() => ChartJS.registry.getPlugin('legend')).not.toThrow()
    })

    it('draws masuk and keluar per month and honours reduced motion', async () => {
        render(<Laporan />)

        expect(await screen.findByTestId('monthly-chart')).toBeInTheDocument()
        expect(chart.props.data.labels).toEqual(['Jan', 'Feb'])
        expect(chart.props.data.datasets.map((dataset) => [dataset.label, dataset.data]))
            .toEqual([['Surat Masuk', [3, 0]], ['Surat Keluar', [1, 0]]])
        expect(chart.props.options.animation).toBe(false)
    })
})
