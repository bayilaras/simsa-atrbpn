import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ router: null, getById: vi.fn(), user: { role: 'admin_unit', unitKerjaId: 'ditjen' } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, isAuthenticated: true, user: state.user }) }))
vi.mock('react-router-dom', async importOriginal => {
    const actual = await importOriginal()
    return { ...actual, createBrowserRouter: routes => {
        state.router = actual.createMemoryRouter(routes, { initialEntries: ['/storage-locations/11111111-1111-4111-8111-111111111111'] })
        return state.router
    } }
})
// The production release keeps its shell inline in App.jsx. Isolate its chrome
// while exercising the real route, access guard, and location page below.
vi.mock('@/components/ui/sidebar', () => ({ SidebarProvider: ({ children }) => <div>{children}</div>, SidebarInset: ({ children }) => <div>{children}</div> }))
vi.mock('@/components/app-sidebar', () => ({ AppSidebar: () => null }))
vi.mock('@/components/app-header', () => ({ AppHeader: () => null }))
vi.mock('@/components/AppServiceNotice', () => ({ AppServiceNotice: () => null }))
vi.mock('@/components/ui/toaster', () => ({ Toaster: () => null }))
vi.mock('@/components/OfflineIndicator', () => ({ OfflineIndicator: () => null }))
vi.mock('@/components/IdleWarningBanner', () => ({ IdleWarningBanner: () => null }))
vi.mock('@/pages/Login', () => ({ default: () => <h1>Login</h1> }))
vi.mock('@/pages/NotFound', () => ({ default: () => <h1>Halaman tidak ditemukan</h1> }))
vi.mock('@/services/storage-location.service', () => ({ default: { getById: state.getById } }))
vi.mock('@/services/settings.service', () => ({ default: { getAllUnitKerja: async () => [] } }))
import App from './App'

const id = '11111111-1111-4111-8111-111111111111'
const nextId = '22222222-2222-4222-8222-222222222222'
const record = { id, unitKerjaId: 'ditjen', code: 'G1-R1', name: 'Ruang arsip sintetis', level: 'ruang', description: 'Lokasi fixture', capacity: 20, currentCount: 3 }
beforeEach(async () => {
    vi.clearAllMocks()
    state.user = { role: 'admin_unit', unitKerjaId: 'ditjen' }
    state.getById.mockResolvedValue(record)
    await act(async () => { await state.router.navigate('/storage-locations/' + id) })
})
afterEach(cleanup)

describe('existing storage QR deep links', () => {
    it('loads the exact location from the scoped API after opening a previously generated QR URL', async () => {
        let finish
        state.getById.mockReturnValue(new Promise(resolve => { finish = resolve }))
        render(<App />)
        await waitFor(() => expect(state.getById).toHaveBeenCalledWith(id, 'ditjen'))
        expect(screen.getByRole('status')).toHaveTextContent('Memuat lokasi')
        await act(async () => finish(record))
        expect(await screen.findByRole('heading', { name: 'Ruang arsip sintetis' })).toBeVisible()
        expect(screen.getByText('G1-R1')).toBeVisible()
        expect(screen.getByText(id)).toBeVisible()
        expect(screen.queryByText('Halaman tidak ditemukan')).not.toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Kembali ke lokasi penyimpanan' })).toHaveAttribute('href', '/storage-locations')
    })

    it.each([403, 404])('shows unavailable feedback for HTTP%s without a previous location leaking', async status => {
        render(<App />)
        await screen.findByRole('heading', { name: record.name })
        state.getById.mockRejectedValue(Object.assign(new Error('Internal details must not be displayed'), { status }))
        await act(async () => { await state.router.navigate('/storage-locations/' + nextId) })
        expect(await screen.findByRole('alert')).toHaveTextContent('Lokasi tidak tersedia atau Anda tidak memiliki akses')
        expect(screen.queryByText(record.name)).not.toBeInTheDocument()
        expect(screen.queryByText(record.code)).not.toBeInTheDocument()
        expect(screen.queryByText('Internal details must not be displayed')).not.toBeInTheDocument()
    })

    it('waits for an explicit unit when a super admin opens an old QR link', async () => {
        state.user = { role: 'super_admin' }
        render(<App />)
        expect(await screen.findByText(/Pilih unit kerja/)).toBeVisible()
        expect(state.getById).not.toHaveBeenCalled()
    })

    it('recovers a temporary load failure without changing the scanned location', async () => {
        state.getById.mockRejectedValueOnce(new Error('Temporary network failure')).mockResolvedValue(record)
        render(<App />)
        expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat lokasi')
        await act(async () => { screen.getByRole('button', { name: 'Coba lagi' }).click() })
        expect(await screen.findByRole('heading', { name: record.name })).toBeVisible()
        expect(state.getById).toHaveBeenLastCalledWith(id, 'ditjen')
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('ignores an earlier location response when another QR opens before it finishes', async () => {
        let finishFirst
        state.getById.mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve }))
            .mockResolvedValue({ ...record, id: nextId, name: 'Lokasi kedua', code: 'G2' })
        render(<App />)
        await waitFor(() => expect(state.getById).toHaveBeenCalledWith(id, 'ditjen'))
        await act(async () => { await state.router.navigate('/storage-locations/' + nextId) })
        expect(await screen.findByRole('heading', { name: 'Lokasi kedua' })).toBeVisible()
        await act(async () => finishFirst(record))
        expect(screen.getByRole('heading', { name: 'Lokasi kedua' })).toBeVisible()
        expect(screen.queryByText(record.name)).not.toBeInTheDocument()
        expect(screen.getByText(nextId)).toBeVisible()
    })

    it('does not display a mismatched record returned for the scanned ID', async () => {
        state.getById.mockResolvedValue({ ...record, id: nextId })
        render(<App />)
        expect(await screen.findByRole('alert')).toHaveTextContent('Data lokasi tidak sesuai dengan tautan yang dibuka')
        expect(screen.queryByText(record.name)).not.toBeInTheDocument()
        expect(screen.queryByText(record.code)).not.toBeInTheDocument()
    })
})
