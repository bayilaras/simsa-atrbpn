import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import RetentionGovernance from './RetentionGovernance'
import RetentionManagement from './RetentionManagement'

const mocks = vi.hoisted(() => ({
    governance: { listAppraisals: vi.fn(), listRetentionEvents: vi.fn(), listPermanentTransfers: vi.fn() },
    retention: { getSummary: vi.fn(), getCandidates: vi.fn(), getHolds: vi.fn() },
}))
vi.mock('@/services/retention-governance.service', () => ({ default: mocks.governance }))
vi.mock('@/services/retention.service', () => ({ default: mocks.retention }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'arsiparis', role: 'admin_unit', unitKerjaId: 'unit-a' } }) }))
vi.mock('@/hooks/use-required-unit-kerja-scope', () => ({ useRequiredUnitKerjaScope: () => ({ unitKerjaId: 'unit-a', loading: false }) }))
vi.mock('@/components/RequiredUnitKerjaScope', () => ({ RequiredUnitKerjaScope: () => null }))

const page = (rows, pageNumber, total) => ({ success: true, data: rows, pagination: { page: pageNumber, limit: 20, total, totalPages: Math.ceil(total / 20) || 1 } })
function show(element) { return render(<MemoryRouter>{element}</MemoryRouter>) }

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

describe('pages with several lists refresh only the list that changed', () => {
    it('retention governance pages the appraisals without refetching events or transfers', async () => {
        mocks.governance.listAppraisals.mockImplementation(async ({ page: pageNumber }) => page([
            { id: `case-${pageNumber}`, arsipId: `arsip-${pageNumber}-0000`, caseType: 'manual', proposedOutcome: 'Musnah', status: 'open' },
        ], pageNumber, 21))
        mocks.governance.listRetentionEvents.mockResolvedValue(page([], 1, 3))
        mocks.governance.listPermanentTransfers.mockResolvedValue(page([], 1, 2))
        show(<RetentionGovernance />)
        expect(await screen.findByRole('tab', { name: 'Appraisal (21)' })).toBeInTheDocument()
        expect(await screen.findByRole('tab', { name: 'Pemicu Retensi (3)' })).toBeInTheDocument()
        expect(await screen.findByRole('tab', { name: 'Penyerahan Permanen (2)' })).toBeInTheDocument()
        expect(screen.getByText('21 data · Halaman 1 dari 2')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
        expect(await screen.findByText('21 data · Halaman 2 dari 2')).toBeInTheDocument()
        expect(mocks.governance.listAppraisals).toHaveBeenLastCalledWith({ page: 2, limit: 20 })
        // The tabs stayed mounted and the other lists were not refetched.
        expect(screen.getByRole('tab', { name: 'Pemicu Retensi (3)' })).toBeInTheDocument()
        expect(mocks.governance.listRetentionEvents).toHaveBeenCalledOnce()
        expect(mocks.governance.listPermanentTransfers).toHaveBeenCalledOnce()
    })

    it('retention management pages the candidates without refetching the summary or legal holds', async () => {
        mocks.retention.getSummary.mockResolvedValue({ data: { alertLevel: 'none' } })
        mocks.retention.getHolds.mockResolvedValue({ data: [] })
        mocks.retention.getCandidates.mockImplementation(async (_unit, { page: pageNumber }) => ({
            data: [], summary: {}, pagination: { page: pageNumber, limit: 20, total: 41, totalPages: 3 },
        }))
        show(<RetentionManagement />)
        expect(await screen.findByText('(41 arsip)', { exact: false })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Selanjutnya' }))
        await waitFor(() => expect(mocks.retention.getCandidates).toHaveBeenLastCalledWith('unit-a', { page: 2, limit: 20 }))
        expect(mocks.retention.getSummary).toHaveBeenCalledOnce()
        expect(mocks.retention.getHolds).toHaveBeenCalledOnce()
    })
})
