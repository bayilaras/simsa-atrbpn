import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ path: '/', user: null, router: null, listeners: new Set(), refresh: vi.fn(), signOut: vi.fn(), workspace: vi.fn(), business: vi.fn() }))
vi.mock('@/context/AuthContext', async () => {
    const { useSyncExternalStore } = await import('react')
    return { useAuth: () => {
        const user = useSyncExternalStore(listener => { state.listeners.add(listener); return () => state.listeners.delete(listener) }, () => state.user)
        return { loading: false, isAuthenticated: Boolean(user), user, checkAuth: state.refresh, signOut: state.signOut }
    } }
})
vi.mock('react-router-dom', async original => {
    const actual = await original()
    return { ...actual, createBrowserRouter: routes => routes, RouterProvider: ({ router }) => {
        state.router = actual.createMemoryRouter(router, { initialEntries: [state.path] })
        return <actual.RouterProvider router={state.router} />
    } }
})
// Observe the production inline workspace through its actual shell provider.
vi.mock('@/components/ui/sidebar', () => ({ SidebarProvider: ({ children }) => { state.workspace(); return <div>{children}</div> }, SidebarInset: ({ children }) => <div>{children}</div> }))
vi.mock('@/components/app-sidebar', () => ({ AppSidebar: () => null }))
vi.mock('@/components/app-header', () => ({ AppHeader: () => null }))
vi.mock('@/components/ui/toaster', () => ({ Toaster: () => null }))
vi.mock('@/components/OfflineIndicator', () => ({ OfflineIndicator: () => null }))
vi.mock('@/components/IdleWarningBanner', () => ({ IdleWarningBanner: () => null }))
vi.mock('@/pages/Dashboard', () => ({ default: () => { state.business(); return <h1>Dashboard tersedia</h1> } }))
vi.mock('@/pages/SuratMasuk', () => ({ default: () => { state.business(); return <h1>Surat tersedia</h1> } }))
vi.mock('@/pages/UserManagement', () => ({ default: () => { state.business(); return <h1>Pengguna tersedia</h1> } }))
vi.mock('@/pages/UserGuide', () => ({ default: () => <h1>Panduan penggunaan</h1> }))
vi.mock('@/components/AppServiceNotice', () => ({ AppServiceNotice: () => null }))
vi.mock('@/pages/Login', () => ({ default: () => <h1>Masuk kembali</h1> }))
import App from './App'

beforeEach(() => {
    vi.clearAllMocks()
    state.path = '/'
    state.user = { id: 'pending-1', email: 'pending@example.test', name: 'Calon pengguna', role: 'user', unitKerjaId: null, isActive: true }
})
afterEach(() => { cleanup(); state.router?.dispose() })

describe('pending Google identity access boundary', () => {
    it.each(['/', '/surat/masuk', '/surat/masuk/known-id', '/users', '/settings', '/formulir/cetak/known-id'])('blocks business route %s before mounting its workspace', async path => {
        state.path = path
        render(<App />)
        expect(await screen.findByRole('status')).toHaveTextContent('Menunggu persetujuan administrator')
        expect(screen.getByText('pending@example.test')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Bantuan akses' })).toHaveAttribute('href', '/panduan')
        expect(state.workspace).not.toHaveBeenCalled()
        expect(state.business).not.toHaveBeenCalled()
    })

    it.each(['pending', 'disabled'])('lets a %s identity read help without mounting the business shell', async kind => {
        state.path = '/panduan'
        if (kind === 'disabled') state.user = { ...state.user, role: 'super_admin', isActive: false }
        render(<App />)
        expect(await screen.findByRole('heading', { name: 'Panduan penggunaan' })).toBeInTheDocument()
        expect(state.workspace).not.toHaveBeenCalled()
        expect(state.business).not.toHaveBeenCalled()
        expect(screen.getByRole('link', { name: 'Kembali ke status akses' })).toHaveAttribute('href', '/')
    })

    it('refreshes its own session and returns to login after an approval revoked that session', async () => {
        render(<App />)
        expect(screen.getByRole('status')).toHaveTextContent(/setelah disetujui.*masuk kembali/i)
        fireEvent.click(screen.getByRole('button', { name: 'Periksa ulang akses' }))
        expect(state.refresh).toHaveBeenCalledOnce()
        await act(async () => { state.user = null; state.listeners.forEach(listener => listener()) })
        expect(await screen.findByRole('heading', { name: 'Masuk kembali' })).toBeInTheDocument()
        expect(state.workspace).not.toHaveBeenCalled()
    })

    it('keeps sign-out available to the pending account', () => {
        render(<App />)
        fireEvent.click(screen.getByRole('button', { name: 'Keluar', exact: true }))
        expect(state.signOut).toHaveBeenCalledOnce()
    })

    it.each([
        { role: 'super_admin', unitKerjaId: null }, { role: 'admin_unit', unitKerjaId: 'ditjen' },
        { role: 'admin_unit', unitKerjaId: 'sesditjen' }, { role: 'admin_dirjen', unitKerjaId: null },
        { role: 'admin_sesditjen', unitKerjaId: null }, { role: 'staff', unitKerjaId: 'ditjen' },
        { role: 'auditor', unitKerjaId: 'ditjen' },
    ])('preserves approved access and help layout for $role/$unitKerjaId', async assignment => {
        state.user = { ...state.user, ...assignment }
        render(<App />)
        expect(await screen.findByRole('heading', { name: 'Dashboard tersedia' })).toBeInTheDocument()
        await act(async () => { await state.router.navigate('/panduan') })
        expect(await screen.findByRole('heading', { name: 'Panduan penggunaan' })).toBeInTheDocument()
        expect(screen.getByRole('main')).toBeInTheDocument()
        await waitFor(() => expect(state.workspace).toHaveBeenCalled())
    })
})
