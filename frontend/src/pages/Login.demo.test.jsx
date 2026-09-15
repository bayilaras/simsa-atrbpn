import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login'

const profile = vi.hoisted(() => ({ mode: 'full', provider: 'better-auth', configured: false, pendingGoogleSignup: false }))
const logout = vi.hoisted(() => ({ signingOut: false, error: null, retry: vi.fn() }))
const emailSignIn = vi.hoisted(() => vi.fn())
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ loading: false,
    authentication: { provider: profile.provider, googleSignIn: profile.configured, pendingGoogleSignup: profile.pendingGoogleSignup },
}) }))
vi.mock('@/lib/app-config', () => ({ default: {
    get mode() { return profile.mode },
    name: 'SIMSA', shortName: 'SIMSA', usageBadge: 'Internal',
} }))
vi.mock('@/lib/cloud-provider-config', () => ({ get AUTH_PROVIDER() { return profile.provider } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({
    loading: logout.signingOut, isAuthenticated: false, error: logout.error,
    signingOut: logout.signingOut, logoutError: logout.error, signOut: logout.retry,
    signInWithGoogle: vi.fn(), signInWithEmail: emailSignIn,
}) }))

describe('demo login provider controls', () => {
    beforeEach(() => {
        logout.signingOut = false; logout.error = null; logout.retry.mockClear()
        emailSignIn.mockReset().mockResolvedValue(undefined)
        Object.assign(profile, { mode: 'full', provider: 'better-auth', configured: false, pendingGoogleSignup: false })
    })
    it('explains pending first Google access only when enabled by the server', () => {
        profile.configured = true
        profile.pendingGoogleSignup = true
        const view = render(<MemoryRouter><Login /></MemoryRouter>)
        expect(screen.getByText(/Akun Google baru/)).toHaveTextContent(/persetujuan administrator/i)
        profile.pendingGoogleSignup = false
        view.rerender(<MemoryRouter><Login /></MemoryRouter>)
        expect(screen.queryByText(/Akun Google baru/)).not.toBeInTheDocument()
    })
    it('keeps credential login usable when the server intentionally disables Google', async () => {
        render(<MemoryRouter><Login /></MemoryRouter>)
        expect(screen.queryByRole('button', { name: 'Masuk dengan Google' })).not.toBeInTheDocument()
        expect(screen.queryByRole('separator')).not.toBeInTheDocument()
        expect(screen.queryByRole('link', { name: /daftar/i })).not.toBeInTheDocument()
        fireEvent.change(screen.getByLabelText('Email kedinasan'), { target: { value: 'operator@example.test' } })
        fireEvent.change(screen.getByLabelText('Kata sandi'), { target: { value: 'synthetic-password-only' } })
        fireEvent.click(screen.getByRole('button', { name: 'Masuk', exact: true }))
        await waitFor(() => expect(emailSignIn).toHaveBeenCalledWith('operator@example.test', 'synthetic-password-only'))
    })
    it('holds the login form while server logout is pending', () => {
        logout.signingOut = true
        render(<MemoryRouter><Login /></MemoryRouter>)
        expect(screen.getByRole('status')).toHaveTextContent('Menutup sesi di server')
        expect(screen.queryByLabelText('Email kedinasan')).not.toBeInTheDocument()
    })
    it('shows a clear remote failure and allows retry without exposing private content', () => {
        logout.error = 'Penutupan sesi server belum terkonfirmasi.'
        render(<MemoryRouter><Login /></MemoryRouter>)
        expect(screen.getByRole('alert')).toHaveTextContent('sesi server belum terkonfirmasi')
        fireEvent.click(screen.getByRole('button', { name: 'Coba keluar lagi' }))
        expect(logout.retry).toHaveBeenCalledOnce()
    })
    it.each([
        ['full', 'better-auth', true, true], ['full', 'better-auth', false, false],
        ['metadata-demo', 'firebase', true, true], ['metadata-demo', 'better-auth', true, false],
    ])('shows Google only when supported (%s/%s configured=%s)', (mode, provider, configured, googleVisible) => {
        Object.assign(profile, { mode, provider, configured })
        render(<MemoryRouter><Login /></MemoryRouter>)
        expect(Boolean(screen.queryByRole('button', { name: 'Masuk dengan Google' }))).toBe(googleVisible)
        expect(screen.getByRole('button', { name: 'Masuk', exact: true })).toBeEnabled()
        if (!googleVisible) {
            expect(screen.getByText(mode === 'metadata-demo' ? 'Masukkan email dan kata sandi akun uji lokal.'
                : 'Masukkan email dan kata sandi yang diberikan administrator.')).toBeInTheDocument()
            expect(screen.queryByRole('separator')).not.toBeInTheDocument()
        }
    })
})
