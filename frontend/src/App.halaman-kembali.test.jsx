import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Sesi berakhir di tengah pekerjaan: halaman yang sedang dibuka diingat di
// sessionStorage tab ini, dan pengguna yang sama dibawa kembali ke sana
// setelah masuk lagi (lib/sesi-masuk.js).

const state = vi.hoisted(() => ({
    path: '/', router: null, listeners: new Set(), dashboard: vi.fn(),
    auth: { user: null, halamanKembali: null },
}))
vi.mock('@/context/AuthContext', async () => {
    const { useSyncExternalStore } = await import('react')
    return { useAuth: () => {
        const auth = useSyncExternalStore(listener => { state.listeners.add(listener); return () => state.listeners.delete(listener) }, () => state.auth)
        return {
            loading: false, isAuthenticated: Boolean(auth.user), user: auth.user, checkAuth: vi.fn(), signOut: vi.fn(),
            halamanKembali: auth.halamanKembali, hapusHalamanKembali: state.hapusHalamanKembali,
        }
    } }
})
vi.mock('react-router-dom', async original => {
    const actual = await original()
    return { ...actual, createBrowserRouter: routes => routes, RouterProvider: ({ router }) => {
        state.router = actual.createMemoryRouter(router, { initialEntries: [state.path] })
        return <actual.RouterProvider router={state.router} />
    } }
})
vi.mock('@/components/ui/sidebar', () => ({ SidebarProvider: ({ children }) => <div>{children}</div>, SidebarInset: ({ children }) => <div>{children}</div> }))
vi.mock('@/components/app-sidebar', () => ({ AppSidebar: () => null }))
vi.mock('@/components/app-header', () => ({ AppHeader: () => null }))
vi.mock('@/components/breadcrumbs', () => ({ Breadcrumbs: () => null }))
vi.mock('@/components/ui/toaster', () => ({ Toaster: () => null }))
vi.mock('@/components/OfflineIndicator', () => ({ OfflineIndicator: () => null }))
vi.mock('@/components/IdleWarningBanner', () => ({ IdleWarningBanner: () => null }))
vi.mock('@/components/AppServiceNotice', () => ({ AppServiceNotice: () => null }))
vi.mock('@/pages/Dashboard', () => ({ default: () => { state.dashboard(); return <h1>Dashboard tersedia</h1> } }))
vi.mock('@/pages/SuratMasuk', () => ({ default: () => <h1>Surat tersedia</h1> }))
vi.mock('@/pages/LembarDisposisi', () => ({ default: () => <h1>Lembar disposisi</h1> }))
vi.mock('@/pages/UserGuide', () => ({ default: () => <h1>Panduan penggunaan</h1> }))
vi.mock('@/pages/Login', () => ({ default: () => <h1>Masuk kembali</h1> }))
import App from './App'
import { ambilHalamanKembali, lupakanHalamanKembali } from '@/lib/sesi-masuk'

const KUNCI = 'simsa:halaman-kembali'
const PENGGUNA = { id: 'u-1', email: 'admin@example.test', name: 'Admin', role: 'super_admin', unitKerjaId: null, isActive: true }
const tersimpan = () => JSON.parse(window.sessionStorage.getItem(KUNCI))
const alamat = () => state.router.state.location.pathname + state.router.state.location.search

function ubahSesi(perubahan) {
    return act(async () => {
        state.auth = { ...state.auth, ...perubahan }
        state.listeners.forEach(listener => listener())
    })
}

beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
    state.path = '/'
    state.auth = { user: PENGGUNA, halamanKembali: null }
    // Seperti AuthContext: mengosongkan halaman yang diingat.
    state.hapusHalamanKembali = vi.fn(() => {
        state.auth = { ...state.auth, halamanKembali: null }
        state.listeners.forEach(listener => listener())
    })
    // AuthContext mencatat pengguna tab ini saat ia masuk.
    ambilHalamanKembali(PENGGUNA.id)
})
afterEach(() => {
    cleanup()
    state.router?.dispose()
})

describe('halaman kembali setelah sesi berakhir', () => {
    it('sesi yang berakhir mengingat halaman yang sedang dibuka, tanpa menaruhnya di alamat halaman masuk', async () => {
        state.path = '/surat/masuk?status=baru&halaman=2'
        render(<App />)
        expect(await screen.findByRole('heading', { name: 'Surat tersedia' })).toBeInTheDocument()

        await ubahSesi({ user: null })
        expect(await screen.findByRole('heading', { name: 'Masuk kembali' })).toBeInTheDocument()
        expect(alamat()).toBe('/login')
        expect(tersimpan()).toEqual({ userId: 'u-1', alamat: '/surat/masuk?status=baru&halaman=2' })

        // Pengguna yang sama mendapat halaman itu kembali; pengguna lain tidak.
        expect(ambilHalamanKembali('u-1')).toBe('/surat/masuk?status=baru&halaman=2')
    })

    it('rute cetak juga diingat', async () => {
        state.path = '/surat/masuk/sm-1/lembar-disposisi'
        render(<App />)
        expect(await screen.findByRole('heading', { name: 'Lembar disposisi' })).toBeInTheDocument()
        await ubahSesi({ user: null })
        expect(await screen.findByRole('heading', { name: 'Masuk kembali' })).toBeInTheDocument()
        expect(tersimpan()).toEqual({ userId: 'u-1', alamat: '/surat/masuk/sm-1/lembar-disposisi' })
    })

    it('keluar dengan sengaja tidak meninggalkan halaman untuk diingat', async () => {
        state.path = '/surat/masuk'
        render(<App />)
        expect(await screen.findByRole('heading', { name: 'Surat tersedia' })).toBeInTheDocument()

        // AuthContext.signOut() tanpa pertahankanIsian melupakan pengguna tab ini lebih dulu.
        lupakanHalamanKembali()
        await ubahSesi({ user: null })
        expect(await screen.findByRole('heading', { name: 'Masuk kembali' })).toBeInTheDocument()
        expect(window.sessionStorage.getItem(KUNCI)).toBeNull()
    })

    it('Dashboard tidak perlu diingat karena sudah menjadi tujuan bawaan', async () => {
        render(<App />)
        expect(await screen.findByRole('heading', { name: 'Dashboard tersedia' })).toBeInTheDocument()
        await ubahSesi({ user: null })
        expect(await screen.findByRole('heading', { name: 'Masuk kembali' })).toBeInTheDocument()
        expect(tersimpan()).toEqual({ userId: 'u-1', alamat: null })
    })

    it('setelah masuk lagi (mis. kembali dari Google ke Dashboard) pengguna dibawa ke halaman yang diingat', async () => {
        state.auth = { user: PENGGUNA, halamanKembali: '/surat/masuk?status=baru' }
        render(<App />)
        expect(await screen.findByRole('heading', { name: 'Surat tersedia' })).toBeInTheDocument()
        expect(alamat()).toBe('/surat/masuk?status=baru')
        expect(state.dashboard).not.toHaveBeenCalled()

        // Ingatan dikosongkan begitu sampai, sehingga Dashboard dapat dibuka seperti biasa.
        await waitFor(() => expect(state.hapusHalamanKembali).toHaveBeenCalled())
        await act(async () => { await state.router.navigate('/') })
        expect(await screen.findByRole('heading', { name: 'Dashboard tersedia' })).toBeInTheDocument()
        expect(alamat()).toBe('/')
    })

    it('halaman panduan yang diingat tidak mengunci pengguna di luar Dashboard', async () => {
        state.path = '/panduan'
        state.auth = { user: PENGGUNA, halamanKembali: '/panduan' }
        render(<App />)
        expect(await screen.findByRole('heading', { name: 'Panduan penggunaan' })).toBeInTheDocument()
        await waitFor(() => expect(state.hapusHalamanKembali).toHaveBeenCalled())
        await act(async () => { await state.router.navigate('/') })
        expect(await screen.findByRole('heading', { name: 'Dashboard tersedia' })).toBeInTheDocument()
    })

    it('pengguna yang membuka halaman lain sendiri tidak dipindahkan ke halaman yang diingat', async () => {
        state.path = '/surat/masuk'
        state.auth = { user: PENGGUNA, halamanKembali: '/users' }
        render(<App />)
        expect(await screen.findByRole('heading', { name: 'Surat tersedia' })).toBeInTheDocument()
        expect(alamat()).toBe('/surat/masuk')
        await waitFor(() => expect(state.hapusHalamanKembali).toHaveBeenCalled())
    })
})
