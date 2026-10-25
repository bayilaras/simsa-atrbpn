// frontend/src/App.lacak-route.test.jsx
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ router: null, user: { role: 'staff', unitKerjaId: 'dir_bppt' } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, isAuthenticated: true, user: state.user }) }))
vi.mock('react-router-dom', async importOriginal => {
    const actual = await importOriginal()
    return { ...actual, createBrowserRouter: routes => {
        state.router = actual.createMemoryRouter(routes, { initialEntries: ['/surat/lacak?q=B-12'] })
        return state.router
    } }
})
vi.mock('@/components/ui/sidebar', () => ({ SidebarProvider: ({ children }) => <div>{children}</div>, SidebarInset: ({ children }) => <div>{children}</div> }))
vi.mock('@/components/app-sidebar', () => ({ AppSidebar: () => null }))
vi.mock('@/components/app-header', () => ({ AppHeader: () => null }))
vi.mock('@/components/AppServiceNotice', () => ({ AppServiceNotice: () => null }))
vi.mock('@/components/ui/toaster', () => ({ Toaster: () => null }))
vi.mock('@/components/OfflineIndicator', () => ({ OfflineIndicator: () => null }))
vi.mock('@/components/IdleWarningBanner', () => ({ IdleWarningBanner: () => null }))
vi.mock('@/pages/Login', () => ({ default: () => <h1>Login</h1> }))
vi.mock('@/pages/NotFound', () => ({ default: () => <h1>Halaman tidak ditemukan</h1> }))
vi.mock('@/pages/LacakSurat', () => ({ default: () => <h1>Lacak Surat</h1> }))
import App from './App'

beforeEach(async () => { await act(async () => { await state.router.navigate('/surat/lacak?q=B-12') }) })
afterEach(cleanup)

describe('route /surat/lacak', () => {
    it.each(['staff', 'auditor', 'admin_unit', 'admin_sesditjen', 'super_admin'])('terbuka untuk role terprovisi %s', async role => {
        state.user = { role, unitKerjaId: role === 'super_admin' || role === 'admin_sesditjen' ? null : 'dir_bppt' }
        render(<App />)
        expect(await screen.findByRole('heading', { name: 'Lacak Surat' })).toBeVisible()
        expect(state.router.state.location.search).toBe('?q=B-12')
        expect(screen.queryByText('Halaman tidak ditemukan')).toBeNull()
    })
})
