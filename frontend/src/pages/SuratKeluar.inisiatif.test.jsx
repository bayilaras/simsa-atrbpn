import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import SuratKeluar from './SuratKeluar'

const mocks = vi.hoisted(() => ({ getAll: vi.fn(), getStats: vi.fn(), toast: vi.fn() }))
vi.mock('@/services/surat-keluar.service', () => ({ default: { getAll: mocks.getAll, getStats: mocks.getStats } }))
vi.mock('@/services/approval.service', () => ({ default: { getPending: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u', role: 'admin_unit', unitKerjaId: 'dir_bppt' }, canWrite: () => true }) }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => null }))
vi.mock('@/components/ImportFromGDrive', () => ({ default: () => null }))
vi.mock('@/components/ImportCsvDialog', () => ({ default: () => null }))

let router
beforeEach(() => {
    vi.clearAllMocks()
    mocks.getStats.mockResolvedValue({ total: 2, diarsipkan: 0 })
    mocks.getAll.mockResolvedValue({ success: true, pagination: { total: 2, totalPages: 1 }, data: [
        { id: 'a', nomorSurat: '001/2026', perihal: 'Surat inisiatif', kepada: 'X', unitKerjaId: 'dir_bppt', approvalStatus: 'draft', asalNaskah: 'inisiatif' },
        { id: 'b', nomorSurat: '002/2026', perihal: 'Surat tindak lanjut', kepada: 'Y', unitKerjaId: 'dir_bppt', approvalStatus: 'draft', asalNaskah: 'tindak_lanjut' },
    ] })
})
afterEach(() => { cleanup(); router?.dispose() })

it('menampilkan split button inisiatif dan badge asal naskah', async () => {
    router = createMemoryRouter([
        { path: '/surat/keluar', element: <SuratKeluar /> },
        { path: '/surat/keluar/inisiatif', element: <h1>Form inisiatif</h1> },
    ], { initialEntries: ['/surat/keluar'] })
    render(<RouterProvider router={router} />)
    await screen.findByText('Surat inisiatif')
    expect(screen.getByRole('link', { name: /Buat Surat Inisiatif/ })).toHaveAttribute('href', '/surat/keluar/inisiatif')
    expect(screen.getByText('Inisiatif', { selector: '[data-badge="asal-naskah"]' })).toBeInTheDocument()
    expect(screen.getByText('Tindak Lanjut', { selector: '[data-badge="asal-naskah"]' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Pilihan surat keluar lainnya' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Keputusan' }))
    await screen.findByRole('heading', { name: 'Form inisiatif' })
    expect(router.state.location.search).toBe('?naskah=Keputusan')
})
