import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Layar galat aplikasi: berbahasa Indonesia di semua rute, ditutup saat pengguna
// berpindah halaman, dan berkas halaman yang gagal diunduh memuat ulang sekali.

const state = vi.hoisted(() => ({
    path: '/', user: null, router: null, reload: vi.fn(),
    dashboardRusak: false, loginRusak: false, lembarRusak: false,
}))
vi.mock('@/context/AuthContext', () => ({
    useAuth: () => ({ loading: false, isAuthenticated: Boolean(state.user), user: state.user, checkAuth: vi.fn(), signOut: vi.fn() }),
}))
vi.mock('react-router-dom', async original => {
    const actual = await original()
    return { ...actual, createBrowserRouter: routes => routes, RouterProvider: ({ router }) => {
        state.router = actual.createMemoryRouter(router, { initialEntries: [state.path] })
        return <actual.RouterProvider router={state.router} />
    } }
})
vi.mock('@/lib/muat-halaman', async original => {
    const actual = await original()
    return { ...actual, muatHalaman: actual.buatPemuatHalaman({ muatUlang: state.reload, sedangDaring: () => true }) }
})
vi.mock('@/components/ui/sidebar', () => ({ SidebarProvider: ({ children }) => <div>{children}</div>, SidebarInset: ({ children }) => <div>{children}</div> }))
vi.mock('@/components/app-sidebar', () => ({ AppSidebar: () => null }))
vi.mock('@/components/app-header', () => ({ AppHeader: () => null }))
vi.mock('@/components/breadcrumbs', () => ({ Breadcrumbs: () => null }))
vi.mock('@/components/ui/toaster', () => ({ Toaster: () => null }))
vi.mock('@/components/OfflineIndicator', () => ({ OfflineIndicator: () => null }))
vi.mock('@/components/IdleWarningBanner', () => ({ IdleWarningBanner: () => null }))
vi.mock('@/components/AppServiceNotice', () => ({ AppServiceNotice: () => null }))
vi.mock('@/pages/Dashboard', () => ({ default: () => {
    if (state.dashboardRusak) throw new Error('render gagal')
    return <h1>Dashboard tersedia</h1>
} }))
vi.mock('@/pages/SuratMasuk', () => ({ default: () => <h1>Surat tersedia</h1> }))
vi.mock('@/pages/SuratKeluar', () => ({ default: () => <h1>Surat keluar tersedia</h1> }))
// Berkas halaman yang tidak dapat diunduh. React.lazy menyimpan hasil pemuatan
// tiap halaman, jadi tiap skenario memakai halamannya sendiri.
vi.mock('@/pages/Laporan', () => { throw new TypeError('Failed to fetch dynamically imported module') })
vi.mock('@/pages/Settings', () => { throw new TypeError('Failed to fetch dynamically imported module') })
vi.mock('@/pages/LembarDisposisi', () => ({ default: () => {
    if (state.lembarRusak) throw new Error('render gagal')
    return <h1>Lembar disposisi</h1>
} }))
vi.mock('@/pages/Login', () => ({ default: () => {
    if (state.loginRusak) throw new Error('render gagal')
    return <h1>Masuk kembali</h1>
} }))
import App from './App'
import { KUNCI_MUAT_ULANG_HALAMAN } from '@/lib/muat-halaman'

const JUDUL_GALAT = 'Terjadi kesalahan pada halaman ini'
const pindah = alamat => act(async () => { await state.router.navigate(alamat) })

beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    window.sessionStorage.clear()
    Object.assign(state, {
        path: '/', dashboardRusak: false, loginRusak: false, lembarRusak: false,
        user: { id: 'u-1', email: 'admin@example.test', name: 'Admin', role: 'super_admin', unitKerjaId: null, isActive: true },
    })
})
afterEach(() => {
    cleanup()
    state.router?.dispose()
    vi.restoreAllMocks()
})

describe('layar galat aplikasi', () => {
    it('ditutup saat pengguna membuka menu lain, dan muncul lagi bila halaman yang rusak dibuka kembali', async () => {
        state.dashboardRusak = true
        render(<App />)
        expect(await screen.findByRole('heading', { name: JUDUL_GALAT })).toBeInTheDocument()

        await pindah('/surat/masuk')
        expect(await screen.findByRole('heading', { name: 'Surat tersedia' })).toBeInTheDocument()
        expect(screen.queryByText(JUDUL_GALAT)).toBeNull()

        await pindah('/')
        expect(await screen.findByRole('heading', { name: JUDUL_GALAT })).toBeInTheDocument()

        // Membuka lagi menu yang sama mencoba ulang halaman itu.
        state.dashboardRusak = false
        await pindah('/')
        expect(await screen.findByRole('heading', { name: 'Dashboard tersedia' })).toBeInTheDocument()
    })

    it('berkas halaman yang gagal diunduh memuat ulang halaman sekali secara otomatis', async () => {
        state.path = '/laporan'
        render(<App />)
        await waitFor(() => expect(state.reload).toHaveBeenCalledOnce())
        expect(window.sessionStorage.getItem(KUNCI_MUAT_ULANG_HALAMAN)).not.toBeNull()
        // Sambil menunggu peramban memuat ulang, halaman tetap "sedang memuat".
        expect(screen.getByRole('status')).toHaveTextContent('Memuat halaman')
        expect(screen.queryByRole('heading', { name: 'Halaman belum dapat dimuat' })).toBeNull()
    })

    it('bila sesudah dimuat ulang masih gagal, layar galat menawarkan Muat ulang halaman dan menu lain tetap terbuka', async () => {
        window.sessionStorage.setItem(KUNCI_MUAT_ULANG_HALAMAN, '1')
        state.path = '/settings'
        render(<App />)
        expect(await screen.findByRole('heading', { name: 'Halaman belum dapat dimuat' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Muat ulang halaman' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Coba Lagi' })).toBeNull()
        expect(state.reload).not.toHaveBeenCalled()

        // Halaman yang berkasnya baru diunduh dan berhasil: penanda muat ulang dihapus.
        await pindah('/surat/keluar')
        expect(await screen.findByRole('heading', { name: 'Surat keluar tersedia' })).toBeInTheDocument()
        expect(screen.queryByText('Halaman belum dapat dimuat')).toBeNull()
        expect(window.sessionStorage.getItem(KUNCI_MUAT_ULANG_HALAMAN)).toBeNull()
    })

    it('halaman masuk memakai layar galat berbahasa Indonesia tanpa tautan Dashboard', async () => {
        state.user = null
        state.path = '/login'
        state.loginRusak = true
        render(<App />)
        expect(await screen.findByRole('heading', { name: JUDUL_GALAT })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Coba Lagi' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Muat ulang halaman' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Ke Dashboard' })).toBeNull()
        expect(screen.queryByText(/Unexpected Application Error/i)).toBeNull()
    })

    it('rute cetak memakai layar galat berbahasa Indonesia', async () => {
        state.path = '/surat/masuk/sm-1/lembar-disposisi'
        state.lembarRusak = true
        render(<App />)
        expect(await screen.findByRole('heading', { name: JUDUL_GALAT })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Ke Dashboard' })).toBeInTheDocument()
        expect(screen.queryByText(/Unexpected Application Error/i)).toBeNull()
    })
})
