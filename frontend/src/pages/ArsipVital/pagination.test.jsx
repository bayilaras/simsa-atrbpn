import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ArsipVital from './index'

const mocks = vi.hoisted(() => ({ findAll: vi.fn(), getStats: vi.fn(), getDueForReview: vi.fn(), toast: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin_unit', unitKerjaId: 'ditjen' } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/arsip-vital.service', () => ({ arsipVitalService: mocks }))
vi.mock('./ArsipVitalForm', () => ({ default: () => null }))
vi.mock('./ArsipVitalDetail', () => ({ default: () => null }))

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getStats.mockResolvedValue({ success: true, data: { total: 11, byStatus: [] } })
    mocks.getDueForReview.mockResolvedValue([])
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('vital archive API pagination contract', () => {
    it('renders an empty successful response without a pagination exception or error notification', async () => {
        mocks.findAll.mockResolvedValue({ success: true, data: [], total: 0, page: 1, totalPages: 0 })
        render(<ArsipVital />)
        expect(await screen.findByText('Belum ada arsip vital yang ditetapkan')).toBeVisible()
        expect(screen.queryByText('Memuat data...')).not.toBeInTheDocument()
        expect(console.error).not.toHaveBeenCalled()
        expect(mocks.toast).not.toHaveBeenCalled()
    })

    it('reaches the second page using the top-level totalPages returned by the API', async () => {
        mocks.findAll.mockImplementation(({ page }) => Promise.resolve({
            success: true, data: [{ id: `vital-${page}`, nomorBerkas: `VITAL-HALAMAN-${page}`, uraianBerkas: 'Arsip sintetis' }],
            total: 11, page, totalPages: 2,
        }))
        render(<ArsipVital />)
        await screen.findByText('VITAL-HALAMAN-1')
        expect(screen.getByText('Halaman 1 dari 2')).toBeVisible()
        fireEvent.click(screen.getByLabelText('Go to next page'))
        expect(await screen.findByText('VITAL-HALAMAN-2')).toBeVisible()
        await waitFor(() => expect(mocks.findAll).toHaveBeenLastCalledWith(expect.objectContaining({ unitKerjaId: 'ditjen', page: 2, limit: 10 })))
        expect(screen.getByText('Halaman 2 dari 2')).toBeVisible()
        expect(screen.queryByText('VITAL-HALAMAN-1')).not.toBeInTheDocument()
        expect(console.error).not.toHaveBeenCalled()
        expect(mocks.toast).not.toHaveBeenCalled()
    })
})
