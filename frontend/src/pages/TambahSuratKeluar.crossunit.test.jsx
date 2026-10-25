import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TambahSuratKeluar from './TambahSuratKeluar'

// F5: in edit mode, getById now succeeds cross-unit and reports aksesMelalui.
// A reader who is not the owner (e.g. reading through a rangkaian as
// pengawas/peserta) must not have the edit form populated -- and must be
// redirected to the read-only detail page instead.

const mocks = vi.hoisted(() => ({ getById: vi.fn(), getByIdMasuk: vi.fn(), navigate: vi.fn(), toast: vi.fn() }))

// useNavigate is stubbed to a plain spy (no real navigation) so the page
// stays mounted and its (should-stay-empty) form fields can be inspected;
// useBlocker (used by useUnsavedChanges) still needs a real data router
// context, so the real implementation is kept via importOriginal.
vi.mock('react-router-dom', async importOriginal => ({ ...await importOriginal(), useNavigate: () => mocks.navigate }))
vi.mock('@/services/surat-keluar.service', () => ({ suratKeluarService: { getById: mocks.getById } }))
vi.mock('@/services/surat-masuk.service', () => ({ suratMasukService: { getById: mocks.getByIdMasuk } }))
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
        { path: '/surat/keluar/edit/:id', element: <TambahSuratKeluar /> },
    ], { initialEntries: [`/surat/keluar/edit/${id}`] })
    routers.push(router)
    return render(<RouterProvider router={router} />)
}

it('tidak mengisi form dan mengalihkan ke detail ketika akses non-owner (peserta)', async () => {
    mocks.getById.mockResolvedValue({
        id: 'surat-1',
        unitKerjaId: 'dir_bppt',
        perihal: 'Perihal rahasia lintas unit',
        nomorSurat: 'ND-99/2026',
        approvalStatus: 'draft',
        aksesMelalui: 'rangkaian_peserta',
    })
    renderEdit('surat-1')

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/surat/keluar/surat-1'))
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
    expect(screen.queryByDisplayValue('Perihal rahasia lintas unit')).toBeNull()
    expect(screen.queryByDisplayValue('ND-99/2026')).toBeNull()
    expect(screen.getByLabelText(/^Perihal/i)).toHaveValue('')
    expect(mocks.getByIdMasuk).not.toHaveBeenCalled()
})

it('mengisi form seperti biasa ketika akses owner', async () => {
    mocks.getById.mockResolvedValue({
        id: 'surat-1',
        unitKerjaId: 'dir_bppt',
        perihal: 'Perihal milik sendiri',
        nomorSurat: 'ND-1/2026',
        approvalStatus: 'draft',
        aksesMelalui: 'owner',
    })
    renderEdit('surat-1')

    expect(await screen.findByDisplayValue('Perihal milik sendiri')).toBeInTheDocument()
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
})
