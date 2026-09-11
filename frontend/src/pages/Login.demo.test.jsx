import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Login from './Login'

const profile = vi.hoisted(() => ({ mode: 'full', provider: 'better-auth', configured: false }))
vi.mock('@/context/app-config-context', () => ({ useAppConfig: () => ({ loading: false,
    authentication: { provider: profile.provider, googleSignIn: profile.configured },
}) }))
vi.mock('@/lib/app-config', () => ({ default: {
    get mode() { return profile.mode },
    name: 'SIMSA', shortName: 'SIMSA', usageBadge: 'Internal',
} }))
vi.mock('@/lib/cloud-provider-config', () => ({ get AUTH_PROVIDER() { return profile.provider } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({
    loading: false, isAuthenticated: false, error: null,
    signInWithGoogle: vi.fn(), signInWithEmail: vi.fn(),
}) }))

describe('demo login provider controls', () => {
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
