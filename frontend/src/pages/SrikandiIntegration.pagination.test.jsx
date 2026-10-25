import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SrikandiIntegration from './SrikandiIntegration'

const mocks = vi.hoisted(() => ({ list: vi.fn(), status: vi.fn(), toast: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'operator', role: 'super_admin' } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/srikandi.service', () => ({ default: { list: mocks.list, status: mocks.status } }))
beforeEach(() => {
    vi.clearAllMocks()
    // jsdom has no layout; Radix still calls this browser method when opening.
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    mocks.status.mockResolvedValue({ data: { ready: false } })
    mocks.list.mockImplementation(({ page, unitKerjaId = 'all' }) => Promise.resolve({
        data: [{ id: `${unitKerjaId}-${page}`, eventType: `Pesan ${unitKerjaId}-${(page - 1) * 20 + 1}`, status: 'pending', unitKerjaId }],
        pagination: { total: 101, page, limit: 20 },
    }))
})
afterEach(() => { delete Element.prototype.scrollIntoView })
describe('SRIKANDI outbox pagination', () => {
    it('reaches entries after 100 and resets the page when the unit or status changes', async () => {
        render(<SrikandiIntegration />)
        await screen.findByText('Pesan all-1')
        const nav = screen.getByRole('navigation', { name: 'Halaman outbox SRIKANDI' })
        for (let page = 2; page <= 6; page += 1) {
            fireEvent.click(within(nav).getByRole('button', { name: 'Berikutnya' }))
            await screen.findByText(`Pesan all-${(page - 1) * 20 + 1}`)
        }
        expect(mocks.list).toHaveBeenLastCalledWith({ page: 6, limit: 20 })
        fireEvent.change(screen.getByRole('textbox', { name: 'Unit kerja outbox' }), { target: { value: 'unit-b' } })
        await screen.findByText('Pesan unit-b-1')
        expect(mocks.list).toHaveBeenLastCalledWith({ page: 1, limit: 20, unitKerjaId: 'unit-b' })
        fireEvent.click(within(nav).getByRole('button', { name: 'Berikutnya' }))
        await screen.findByText('Pesan unit-b-21')
        fireEvent.keyDown(screen.getByRole('combobox', { name: 'Status outbox' }), { key: 'Enter' })
        fireEvent.click(await screen.findByRole('option', { name: 'Dead letter' }))
        await screen.findByText('Pesan unit-b-1')
        expect(mocks.list).toHaveBeenLastCalledWith({ page: 1, limit: 20, unitKerjaId: 'unit-b', status: 'dead_letter' })
    })
})
