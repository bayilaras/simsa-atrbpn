import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ArchiveLending from './ArchiveLending'

// Peminjaman "Per Box" hanya menawarkan boks: server menolak gedung, ruang, dan rak.
const mocks = vi.hoisted(() => ({
    lending: { getAll: vi.fn(), getStats: vi.fn(), borrow: vi.fn() },
    cariLokasi: vi.fn(),
    cariArsip: vi.fn(),
    toast: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin_unit', unitKerjaId: 'unit-a' } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/archive-lending.service', () => ({ default: mocks.lending }))
vi.mock('@/services/arsip.service', () => ({ default: { search: mocks.cariArsip } }))
vi.mock('@/services/storage-location.service', () => ({ default: { getAll: mocks.cariLokasi } }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: async () => [{ id: 'unit-a', name: 'Unit A' }] } }))

beforeEach(() => {
    vi.clearAllMocks()
    mocks.lending.getAll.mockResolvedValue({ success: true, data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } })
    mocks.lending.getStats.mockResolvedValue({ success: true, data: { borrowed: 0, overdue: 0, returned: 0, total: 0 } })
    mocks.cariLokasi.mockResolvedValue({ success: true, data: [{ id: 'box-1', code: 'G1-R1-B1', name: 'Boks Satu', level: 'box' }] })
    // jsdom tidak punya scrollIntoView; Select memanggilnya saat dibuka.
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})
afterEach(() => {
    delete Element.prototype.scrollIntoView
    cleanup()
})

it('pencarian sasaran Per Box hanya meminta lokasi tingkat boks', async () => {
    render(<MemoryRouter initialEntries={['/archive-lending']}><ArchiveLending /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Catat Peminjaman' }))
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Tipe' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Per Box' }))

    fireEvent.change(await within(dialog).findByRole('textbox', { name: 'Cari boks yang akan dipinjam' }), { target: { value: 'G1-' } })
    await waitFor(() => expect(mocks.cariLokasi).toHaveBeenCalledWith({ search: 'G1-', limit: 5, unitKerjaId: 'unit-a', level: 'box' }))
    expect(mocks.cariArsip).not.toHaveBeenCalled()

    const hasil = await within(dialog).findByRole('button', { name: /G1-R1-B1/ })
    expect(hasil).toHaveTextContent('Boks Satu · Boks')
})
