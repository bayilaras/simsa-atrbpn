import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RecordAccessGrants from './RecordAccessGrants'

const mocks = vi.hoisted(() => ({ mine: vi.fn(), review: vi.fn(), role: 'super_admin', toast: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'operator', role: mocks.role } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/record-access-grant.service', () => ({ default: { listMine: mocks.mine, listForReview: mocks.review } }))

function pageResult(category, page, total = 101) {
    return { data: [{ id: `${category}-${page}`, entityType: 'arsip', entityId: `${category}-${(page - 1) * 20 + 1}`,
        status: category === 'mine' ? 'pending' : category, purpose: 'Keperluan dinas', accessMode: 'view' }],
    pagination: { page, limit: 20, total, totalPages: Math.ceil(total / 20) } }
}
function chooseTab(name) {
    fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false })
}
beforeEach(() => {
    vi.clearAllMocks()
    mocks.role = 'super_admin'
    mocks.mine.mockImplementation(({ page }) => Promise.resolve(pageResult('mine', page)))
    mocks.review.mockImplementation(({ page, status }) => Promise.resolve(pageResult(status, page)))
})

describe('record access pagination', () => {
    it('reaches record 101 and retains an independent page for each review category', async () => {
        render(<RecordAccessGrants />)
        await screen.findByText('mine-1')
        const mineNav = screen.getByRole('navigation', { name: 'Halaman permohonan saya' })
        for (let page = 2; page <= 6; page += 1) {
            fireEvent.click(within(mineNav).getByRole('button', { name: 'Berikutnya' }))
            await screen.findByText(`mine-${(page - 1) * 20 + 1}`)
        }
        expect(within(mineNav).getByRole('button', { name: 'Berikutnya' })).toBeDisabled()
        expect(mocks.mine).toHaveBeenLastCalledWith({ page: 6, limit: 20 })

        chooseTab(/Perlu Keputusan/)
        await screen.findByText('pending-1')
        fireEvent.click(within(screen.getByRole('navigation', { name: 'Halaman perlu keputusan' })).getByRole('button', { name: 'Berikutnya' }))
        await screen.findByText('pending-21')
        chooseTab(/Disetujui/)
        await screen.findByText('approved-1')
        fireEvent.click(within(screen.getByRole('navigation', { name: 'Halaman disetujui' })).getByRole('button', { name: 'Berikutnya' }))
        await screen.findByText('approved-21')
        expect(mocks.review).toHaveBeenCalledWith({ status: 'pending', page: 2, limit: 20 })
        expect(mocks.review).toHaveBeenCalledWith({ status: 'approved', page: 2, limit: 20 })
        chooseTab(/Perlu Keputusan/)
        expect(screen.getByText('pending-21')).toBeInTheDocument()
        chooseTab(/Permohonan Saya/)
        expect(screen.getByText('mine-101')).toBeInTheDocument()
    })

    it('never requests reviewer data for staff and distinguishes failure from an empty list', async () => {
        mocks.role = 'staff'
        mocks.mine.mockRejectedValueOnce(new Error('Daftar belum dapat diambil'))
        render(<RecordAccessGrants />)
        expect(await screen.findByRole('alert')).toHaveTextContent('Daftar belum dapat diambil')
        expect(screen.queryByText(/Belum ada permohonan/)).not.toBeInTheDocument()
        expect(mocks.review).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
        await screen.findByText('mine-1')
        await waitFor(() => expect(mocks.mine).toHaveBeenCalledTimes(2))
    })
})
