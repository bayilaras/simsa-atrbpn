import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratMasuk from './TambahSuratMasuk'

// F5: in edit mode, getById now succeeds cross-unit and reports aksesMelalui.
// A reader who is not the owner (e.g. reading through a rangkaian as
// pengawas/peserta) must not have the edit form populated -- and must be
// redirected to the read-only detail page instead.

const mocks = vi.hoisted(() => ({ getById: vi.fn(), navigate: vi.fn(), toast: vi.fn() }))

// useNavigate is stubbed to a plain spy (no real navigation) so the page
// stays mounted and its (should-stay-empty) form fields can be inspected;
// useBlocker (used by useUnsavedChanges) still needs a real data router
// context, so the real implementation is kept via importOriginal.
vi.mock('react-router-dom', async importOriginal => ({ ...await importOriginal(), useNavigate: () => mocks.navigate }))
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: { getById: mocks.getById } }))
vi.mock('@/context/AuthContext', () => ({
    useAuth: () => ({ user: { id: 'user-a', role: 'admin_unit', unitKerjaId: 'dir_bppt' } }),
}))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ capabilities: { files: false, fileUploads: false, letterFileUploads: false } }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }))

let routers = []

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => {
    cleanup()
    routers.forEach(router => router.dispose())
    routers = []
})

function renderEdit(id) {
    const router = createMemoryRouter([
        { path: '/surat/masuk/edit/:id', element: <TambahSuratMasuk /> },
    ], { initialEntries: [`/surat/masuk/edit/${id}`] })
    routers.push(router)
    return render(<RouterProvider router={router} />)
}

it('tidak mengisi form dan mengalihkan ke detail ketika akses non-owner (pengawas)', async () => {
    mocks.getById.mockResolvedValue({
        id: 'surat-1',
        unitKerjaId: 'dir_bppt',
        perihal: 'Perihal rahasia lintas unit',
        nomorSurat: 'SM-99/2026',
        aksesMelalui: 'rangkaian_pengawas',
    })
    renderEdit('surat-1')

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/surat/masuk/surat-1'))
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
    expect(screen.queryByDisplayValue('Perihal rahasia lintas unit')).toBeNull()
    expect(screen.queryByDisplayValue('SM-99/2026')).toBeNull()
    expect(screen.getByLabelText(/perihal/i)).toHaveValue('')
})

it('mengisi form seperti biasa ketika akses owner', async () => {
    mocks.getById.mockResolvedValue({
        id: 'surat-1',
        unitKerjaId: 'dir_bppt',
        perihal: 'Perihal milik sendiri',
        nomorSurat: 'SM-1/2026',
        aksesMelalui: 'owner',
    })
    renderEdit('surat-1')

    expect(await screen.findByDisplayValue('Perihal milik sendiri')).toBeInTheDocument()
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
})
