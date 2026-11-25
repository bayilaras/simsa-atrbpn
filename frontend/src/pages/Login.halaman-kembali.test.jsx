import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login'

// Setelah masuk lagi, pengguna yang sama kembali ke halaman yang dibukanya saat
// sesi berakhir; AuthContext yang menentukan halamannya (halamanKembali).

const auth = vi.hoisted(() => ({ isAuthenticated: false, halamanKembali: null, signInWithEmail: vi.fn() }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ loading: false,
    authentication: { provider: 'better-auth', googleSignIn: false, pendingGoogleSignup: false },
}) }))
vi.mock('@/lib/app-config', () => ({ default: { name: 'SIMSA', shortName: 'SIMSA', usageBadge: 'Internal' } }))
vi.mock('@/lib/cloud-provider-config', () => ({ AUTH_PROVIDER: 'better-auth' }))
vi.mock('@/components/AppServiceNotice', () => ({ AppServiceNotice: () => null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({
    loading: false, isAuthenticated: auth.isAuthenticated, error: null, signingOut: false, logoutError: null,
    signOut: vi.fn(), signInWithGoogle: vi.fn(), signInWithEmail: auth.signInWithEmail,
    sessionNotice: null, halamanKembali: auth.halamanKembali,
}) }))

function Alamat() {
    const location = useLocation()
    return <div data-testid="alamat">{location.pathname + location.search}</div>
}

const bukaHalamanMasuk = () => render(<MemoryRouter initialEntries={['/login']}><Login /><Alamat /></MemoryRouter>)
const alamat = () => screen.getByTestId('alamat').textContent

async function masukDenganKataSandi() {
    fireEvent.change(screen.getByLabelText('Email kedinasan'), { target: { value: 'pegawai@example.test' } })
    fireEvent.change(screen.getByLabelText('Kata sandi'), { target: { value: 'sandi-sintetis' } })
    fireEvent.click(screen.getByRole('button', { name: 'Masuk', exact: true }))
    await waitFor(() => expect(auth.signInWithEmail).toHaveBeenCalledOnce())
}

beforeEach(() => {
    auth.isAuthenticated = false
    auth.halamanKembali = null
    auth.signInWithEmail.mockReset().mockResolvedValue(null)
})
afterEach(cleanup)

describe('tujuan setelah masuk', () => {
    it('masuk dengan kata sandi membawa pengguna ke halaman yang diingat', async () => {
        auth.signInWithEmail.mockResolvedValue('/surat/masuk/tambah?dari=daftar')
        bukaHalamanMasuk()
        await masukDenganKataSandi()
        await waitFor(() => expect(alamat()).toBe('/surat/masuk/tambah?dari=daftar'))
    })

    it('tanpa halaman yang diingat, pengguna mendarat di Dashboard', async () => {
        bukaHalamanMasuk()
        await masukDenganKataSandi()
        await waitFor(() => expect(alamat()).toBe('/'))
    })

    it.each([
        ['alamat situs lain', 'https://contoh-jahat.example/surat'],
        ['alamat tanpa skema', '//contoh-jahat.example'],
        ['garis miring terbalik', '/\\contoh-jahat.example'],
        ['halaman masuk', '/login?sesi=berakhir'],
        ['bukan teks', { pathname: '/surat/masuk' }],
    ])('alamat kembali yang tidak aman (%s) diganti Dashboard', async (_nama, kembali) => {
        auth.signInWithEmail.mockResolvedValue(kembali)
        bukaHalamanMasuk()
        await masukDenganKataSandi()
        await waitFor(() => expect(alamat()).toBe('/'))
    })

    it('pengguna yang sudah masuk (mis. kembali dari Google) dibawa ke halaman yang diingat', () => {
        auth.isAuthenticated = true
        auth.halamanKembali = '/arsip/masuk?halaman=2'
        bukaHalamanMasuk()
        expect(alamat()).toBe('/arsip/masuk?halaman=2')
    })

    it('pengguna yang sudah masuk tanpa halaman yang diingat dibawa ke Dashboard', () => {
        auth.isAuthenticated = true
        bukaHalamanMasuk()
        expect(alamat()).toBe('/')
    })

    it('halaman yang diingat tetapi tidak aman tidak pernah dituju', () => {
        auth.isAuthenticated = true
        auth.halamanKembali = '//contoh-jahat.example/surat'
        bukaHalamanMasuk()
        expect(alamat()).toBe('/')
    })
})
