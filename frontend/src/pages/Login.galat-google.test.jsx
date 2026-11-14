import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login'

const auth = vi.hoisted(() => ({ signInWithGoogle: vi.fn() }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ loading: false,
    authentication: { provider: 'better-auth', googleSignIn: true, pendingGoogleSignup: true },
}) }))
vi.mock('@/lib/app-config', () => ({ default: { name: 'SIMSA', shortName: 'SIMSA', usageBadge: 'Internal' } }))
vi.mock('@/lib/cloud-provider-config', () => ({ AUTH_PROVIDER: 'better-auth' }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({
    loading: false, isAuthenticated: false, error: null, signingOut: false, logoutError: null, sessionNotice: null,
    signOut: vi.fn(), signInWithGoogle: auth.signInWithGoogle, signInWithEmail: vi.fn(),
}) }))

function Alamat() {
    const location = useLocation()
    return <div data-testid="alamat">{location.pathname + location.search}</div>
}

function bukaHalamanMasuk(alamat) {
    return render(<MemoryRouter initialEntries={[alamat]}><Login /><Alamat /></MemoryRouter>)
}

describe('masuk dengan Google yang ditolak', () => {
    beforeEach(() => auth.signInWithGoogle.mockReset())

    it.each([
        ['unable_to_create_session', 'Akun Anda tidak aktif atau belum disetujui. Hubungi Super Admin.'],
        ['GOOGLE_EMAIL_VERIFICATION_REQUIRED', 'Email akun Google Anda belum terverifikasi. Verifikasi email itu di akun Google, lalu coba lagi.'],
        ['account_not_linked', 'Email akun Google Anda belum terverifikasi. Verifikasi email itu di akun Google, lalu coba lagi.'],
        ['signup_disabled', 'Akun Google ini belum terdaftar di SIMSA. Minta Super Admin mendaftarkan akun Anda.'],
        ['GOOGLE_SIGNUP_DISABLED', 'Akun Google ini belum terdaftar di SIMSA. Minta Super Admin mendaftarkan akun Anda.'],
        ['state_not_found', 'Masuk dengan Google gagal. Silakan coba lagi atau hubungi Super Admin.'],
        ['constructor', 'Masuk dengan Google gagal. Silakan coba lagi atau hubungi Super Admin.'],
    ])('menjelaskan kode %s dalam bahasa Indonesia lalu membersihkan alamat', async (kode, pesan) => {
        bukaHalamanMasuk(`/login?error=${kode}&error_description=Unable%20to%20create%20session`)
        expect(screen.getByRole('alert')).toHaveTextContent(pesan)
        expect(screen.queryByText(/Unable to create session/)).not.toBeInTheDocument()
        await waitFor(() => expect(screen.getByTestId('alamat')).toHaveTextContent(/^\/login$/))
        expect(screen.getByRole('alert')).toHaveTextContent(pesan)
    })

    it('menghapus pesan saat pengguna mencoba masuk lagi dengan Google', () => {
        bukaHalamanMasuk('/login?error=signup_disabled')
        fireEvent.click(screen.getByRole('button', { name: 'Masuk dengan Google' }))
        expect(auth.signInWithGoogle).toHaveBeenCalledOnce()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('tidak menampilkan galat pada halaman masuk biasa', () => {
        bukaHalamanMasuk('/login')
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
})
