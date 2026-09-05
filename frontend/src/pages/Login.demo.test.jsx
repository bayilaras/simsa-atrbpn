import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Login from './Login'

const profile = vi.hoisted(() => ({ mode: 'full', provider: 'better-auth' }))
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
        ['full', 'better-auth', true], ['metadata-demo', 'firebase', true],
        ['metadata-demo', 'better-auth', false],
    ])('shows Google only when supported (%s/%s)', (mode, provider, googleVisible) => {
        Object.assign(profile, { mode, provider })
        render(<MemoryRouter><Login /></MemoryRouter>)
        expect(Boolean(screen.queryByRole('button', { name: 'Masuk dengan Google' }))).toBe(googleVisible)
        expect(screen.getByRole('button', { name: 'Masuk', exact: true })).toBeEnabled()
        if (!googleVisible) {
            expect(screen.getByText('Masukkan email dan kata sandi akun uji lokal.')).toBeInTheDocument()
            expect(screen.queryByRole('separator')).not.toBeInTheDocument()
        }
    })
})
