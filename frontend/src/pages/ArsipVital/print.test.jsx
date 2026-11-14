import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ArsipVital from './index'

const mocks = vi.hoisted(() => ({ findAll: vi.fn(), getStats: vi.fn(), getDueForReview: vi.fn(), printDaftar: vi.fn(), toast: vi.fn() }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin_unit', unitKerjaId: 'ditjen' } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/services/arsip-vital.service', () => ({ arsipVitalService: mocks }))
vi.mock('./ArsipVitalForm', () => ({ default: () => null }))
vi.mock('./ArsipVitalDetail', () => ({ default: () => null }))

beforeEach(() => {
    vi.clearAllMocks()
    mocks.findAll.mockResolvedValue({ success: true, data: [], total: 0, page: 1, totalPages: 0 })
    mocks.getStats.mockResolvedValue({ success: true, data: { total: 0, byStatus: [] } })
    mocks.getDueForReview.mockResolvedValue([])
    mocks.printDaftar.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }))
    vi.stubGlobal('URL', class extends URL {
        static createObjectURL = vi.fn().mockReturnValue('blob:daftar')
        static revokeObjectURL = vi.fn()
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    // jsdom tidak punya scrollIntoView; Select memanggilnya saat dibuka.
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})
afterEach(() => {
    delete Element.prototype.scrollIntoView
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('Cetak Daftar Arsip Vital', () => {
    it('mencetak dengan filter yang sedang dipakai tabel', async () => {
        render(<ArsipVital />)
        await waitFor(() => expect(mocks.findAll).toHaveBeenCalled())

        fireEvent.change(screen.getByPlaceholderText('Cari arsip vital...'), { target: { value: 'perkara' } })
        await waitFor(() => expect(mocks.findAll).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'perkara' })))

        const [kategori, status] = screen.getAllByRole('combobox')
        fireEvent.keyDown(kategori, { key: 'Enter' })
        fireEvent.click(await screen.findByRole('option', { name: 'Hukum (Perjanjian, Hak Paten, Perkara)' }))
        fireEvent.keyDown(status, { key: 'Enter' })
        fireEvent.click(await screen.findByRole('option', { name: 'Belum Diproteksi' }))
        await waitFor(() => expect(mocks.findAll).toHaveBeenLastCalledWith(expect.objectContaining({
            search: 'perkara', kategoriVital: 'hukum', statusProteksi: 'belum_diproteksi',
        })))

        fireEvent.click(screen.getByRole('button', { name: /Cetak Daftar/ }))
        await waitFor(() => expect(mocks.printDaftar).toHaveBeenCalledWith('ditjen', {
            search: 'perkara', kategoriVital: 'hukum', statusProteksi: 'belum_diproteksi',
        }))
        expect(mocks.toast).not.toHaveBeenCalled()
    })

    it('tanpa filter mencetak seluruh daftar unit', async () => {
        render(<ArsipVital />)
        await waitFor(() => expect(mocks.findAll).toHaveBeenCalled())
        fireEvent.click(screen.getByRole('button', { name: /Cetak Daftar/ }))
        await waitFor(() => expect(mocks.printDaftar).toHaveBeenCalledWith('ditjen', {
            search: '', kategoriVital: '', statusProteksi: '',
        }))
    })
})
