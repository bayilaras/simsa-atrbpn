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
        const service = createAuthService({ legacyClient: { signIn: { social } } })

        await expect(service.signInWithGoogle()).rejects.toThrow('Google sign-in is unavailable')
    })

    it('supplies an actionable fallback when a resolved provider error has no message', async () => {
        const social = vi.fn().mockResolvedValue({ data: null, error: { status: 503 } })
        const service = createAuthService({ legacyClient: { signIn: { social } } })

        await expect(service.signInWithGoogle()).rejects.toThrow('Login Google gagal. Silakan coba lagi.')
    })

    it('preserves successful redirect initiation and the current-origin callback', async () => {
        const result = { data: { url: 'https://accounts.google.com/o/oauth2/v2/auth', redirect: true }, error: null }
        const social = vi.fn().mockResolvedValue(result)
        const service = createAuthService({ legacyClient: { signIn: { social } } })

        await expect(service.signInWithGoogle()).resolves.toBe(result)
        expect(social).toHaveBeenCalledExactlyOnceWith({ provider: 'google', callbackURL: window.location.origin })
    })

    it('keeps rejected network failures available to the login context', async () => {
        const failure = new Error('Network unavailable')
        const social = vi.fn().mockRejectedValue(failure)
        const service = createAuthService({ legacyClient: { signIn: { social } } })

        await expect(service.signInWithGoogle()).rejects.toBe(failure)
    })
})
