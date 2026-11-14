import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login'

const auth = vi.hoisted(() => ({ sessionNotice: null }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ loading: false,
    authentication: { provider: 'better-auth', googleSignIn: false, pendingGoogleSignup: false },
}) }))
vi.mock('@/lib/app-config', () => ({ default: { name: 'SIMSA', shortName: 'SIMSA', usageBadge: 'Internal' } }))
vi.mock('@/lib/cloud-provider-config', () => ({ AUTH_PROVIDER: 'better-auth' }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({
    loading: false, isAuthenticated: false, error: null, signingOut: false, logoutError: null,
    signOut: vi.fn(), signInWithGoogle: vi.fn(), signInWithEmail: vi.fn(), sessionNotice: auth.sessionNotice,
}) }))

function Alamat() {
    const location = useLocation()
    return <div data-testid="alamat">{location.pathname + location.search}</div>
}

function bukaHalamanMasuk(alamat) {
    return render(<MemoryRouter initialEntries={[alamat]}><Login /><Alamat /></MemoryRouter>)
}

describe('halaman masuk setelah sesi berakhir', () => {
    beforeEach(() => { auth.sessionNotice = null })

    it('menjelaskan sesi yang ditolak server karena tidak ada aktivitas lalu membersihkan alamat', async () => {
        bukaHalamanMasuk('/login?sesi=berakhir')
        expect(screen.getByRole('status')).toHaveTextContent('Sesi berakhir karena tidak ada aktivitas. Silakan masuk kembali.')
        await waitFor(() => expect(screen.getByTestId('alamat')).toHaveTextContent(/^\/login$/))
        expect(screen.getByRole('status')).toHaveTextContent('Sesi berakhir karena tidak ada aktivitas.')
    })

    it('menampilkan alasan dari logout otomatis di tab yang sama', () => {
        auth.sessionNotice = 'Sesi berakhir karena tidak ada aktivitas. Silakan masuk kembali.'
        bukaHalamanMasuk('/login')
        expect(screen.getByRole('status')).toHaveTextContent('Sesi berakhir karena tidak ada aktivitas.')
    })

    it('tidak menampilkan keterangan pada halaman masuk biasa', () => {
        bukaHalamanMasuk('/login?sesi=lain')
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
})
