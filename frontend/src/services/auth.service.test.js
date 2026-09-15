import { describe, expect, it, vi } from 'vitest'
import { authService, createAuthService } from './auth.service'

describe('authService authentication surface', () => {
    it('exposes only credential and provider sign-in flows, without a development bypass', () => {
        expect(authService).not.toHaveProperty('devLogin')
        expect(authService).toHaveProperty('signInWithEmail')
        expect(authService).toHaveProperty('signInWithGoogle')
    })
})

describe('Better Auth Google sign-in', () => {
    it('rejects a resolved provider error so the login context can stop loading and show it', async () => {
        const social = vi.fn().mockResolvedValue({
            data: null, error: { message: 'Google sign-in is unavailable', status: 400 },
        })
        const service = createAuthService({ provider: 'better-auth', legacyClient: { signIn: { social } } })

        await expect(service.signInWithGoogle()).rejects.toThrow('Google sign-in is unavailable')
    })

    it('supplies an actionable fallback when a resolved provider error has no message', async () => {
        const social = vi.fn().mockResolvedValue({ data: null, error: { status: 503 } })
        const service = createAuthService({ provider: 'better-auth', legacyClient: { signIn: { social } } })

        await expect(service.signInWithGoogle()).rejects.toThrow('Login Google gagal. Silakan coba lagi.')
    })

    it('preserves successful redirect initiation and the current-origin callback', async () => {
        const result = { data: { url: 'https://accounts.google.com/o/oauth2/v2/auth', redirect: true }, error: null }
        const social = vi.fn().mockResolvedValue(result)
        const service = createAuthService({ provider: 'better-auth', legacyClient: { signIn: { social } } })

        await expect(service.signInWithGoogle()).resolves.toBe(result)
        expect(social).toHaveBeenCalledExactlyOnceWith({ provider: 'google', callbackURL: window.location.origin })
    })

    it('keeps rejected network failures available to the login context', async () => {
        const failure = new Error('Network unavailable')
        const social = vi.fn().mockRejectedValue(failure)
        const service = createAuthService({ provider: 'better-auth', legacyClient: { signIn: { social } } })

        await expect(service.signInWithGoogle()).rejects.toBe(failure)
    })
})

describe('Firebase auth session bridge', () => {
    const csrfToken = 'c'.repeat(43)

    function dependencies() {
        return {
            apiClient: {
                get: vi.fn(),
                post: vi.fn(),
            },
            firebase: {
                signInWithGoogle: vi.fn(),
                signInWithEmail: vi.fn(),
                getIdToken: vi.fn(),
                signOut: vi.fn().mockResolvedValue(undefined),
            },
            clearStorage: vi.fn().mockResolvedValue(undefined),
            setCsrfToken: vi.fn(),
            clearCsrfToken: vi.fn(),
        }
    }

    it('exchanges a Google ID token for the backend HttpOnly session', async () => {
        const deps = dependencies()
        const firebaseUser = { uid: 'firebase-user' }
        const session = { user: { id: 'database-user' }, csrfToken }
        deps.firebase.signInWithGoogle.mockResolvedValue(firebaseUser)
        deps.firebase.getIdToken.mockResolvedValue('firebase-id-token')
        deps.apiClient.post.mockResolvedValue(session)
        const service = createAuthService({ provider: 'firebase', ...deps })

        await expect(service.signInWithGoogle()).resolves.toEqual(session)
        expect(deps.firebase.getIdToken).toHaveBeenCalledWith(firebaseUser, true)
        expect(deps.apiClient.post).toHaveBeenCalledWith('/api/auth/session', {
            idToken: 'firebase-id-token',
        })
        expect(deps.setCsrfToken).toHaveBeenCalledWith(csrfToken)
        expect(deps.firebase.signOut).toHaveBeenCalledOnce()
    })

    it('restores CSRF state when it reads an existing Firebase session', async () => {
        const deps = dependencies()
        deps.apiClient.get.mockResolvedValue({ user: { id: 'user' }, csrfToken })
        const service = createAuthService({ provider: 'firebase', ...deps })

        await expect(service.getSession()).resolves.toMatchObject({ user: { id: 'user' } })
        expect(deps.apiClient.get).toHaveBeenCalledWith('/api/auth/get-session')
        expect(deps.setCsrfToken).toHaveBeenCalledWith(csrfToken)
    })

    it('clears local state after sign-out and after confirmed global revocation', async () => {
        const deps = dependencies()
        deps.apiClient.post.mockResolvedValue(null)
        const service = createAuthService({ provider: 'firebase', ...deps })

        await service.signOut()
        await service.revokeSessions()

        expect(deps.apiClient.post).toHaveBeenNthCalledWith(1, '/api/auth/sign-out')
        expect(deps.apiClient.post).toHaveBeenNthCalledWith(2, '/api/auth/revoke-sessions')
        expect(deps.clearCsrfToken).toHaveBeenCalledTimes(2)
        expect(deps.clearStorage).toHaveBeenCalledTimes(2)
    })
})
