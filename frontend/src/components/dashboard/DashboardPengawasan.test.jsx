import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import DashboardPengawasan from './DashboardPengawasan'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/services/api', () => ({ api: { get: mocks.get } }))
vi.mock('react-chartjs-2', () => {
    const Chart = ({ options }) => <div data-testid="chart" data-animation={String(options.animation)} />
    return { Line: Chart, Bar: Chart }
})
const respond = async path => path.endsWith('/compliance') ? { verifiedCoveragePercent: 75, verified: 3, totalArchives: 4 } : []
beforeEach(() => {
    mocks.get.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('supervision status fidelity', () => {
    it('shows a failed request and retry instead of 100% verified or an empty healthy queue', async () => {
        mocks.get.mockRejectedValue(new Error('offline'))
        render(<MemoryRouter><DashboardPengawasan /></MemoryRouter>)
        expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat data pengawasan')
        expect(screen.queryByText('100%')).not.toBeInTheDocument()
        expect(screen.queryByText('Tidak ada masalah kualitas yang terbuka.')).not.toBeInTheDocument()
        mocks.get.mockImplementation(respond)
        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
        expect(await screen.findByText('75%')).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        for (const chart of screen.getAllByTestId('chart')) expect(chart).toHaveAttribute('data-animation', 'false')
    })
    it('keeps the last successful data with an explicit stale label when a refresh fails', async () => {
        mocks.get.mockImplementation(respond)
        render(<MemoryRouter><DashboardPengawasan /></MemoryRouter>)
        await screen.findByText('75%')
        mocks.get.mockRejectedValue(new Error('offline'))
        fireEvent.click(screen.getByRole('button', { name: 'Perbarui data pengawasan' }))
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Data terakhir'))
        expect(screen.getByText('75%')).toBeInTheDocument()
        expect(screen.queryByText('Tidak ada masalah kualitas yang terbuka.')).not.toBeInTheDocument()
    })
    it('does not turn a malformed response into an empty healthy queue', async () => {
        mocks.get.mockResolvedValue({})
        render(<MemoryRouter><DashboardPengawasan /></MemoryRouter>)
        expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat data pengawasan')
        expect(screen.queryByText('100%')).not.toBeInTheDocument()
        expect(screen.queryByText(/Tidak ada masalah kualitas/)).not.toBeInTheDocument()
    })
    it('supports wrapped responses without inventing missing numeric metrics', async () => {
        mocks.get.mockImplementation(async path => ({ data: path.endsWith('/compliance') ? {} : [] }))
        render(<MemoryRouter><DashboardPengawasan /></MemoryRouter>)
        expect(await screen.findByText('Cakupan Aturan Terverifikasi')).toBeInTheDocument()
        expect(screen.queryByText('100%')).not.toBeInTheDocument()
        expect(screen.queryByText('0 dari 0 arsip')).not.toBeInTheDocument()
    })
});
