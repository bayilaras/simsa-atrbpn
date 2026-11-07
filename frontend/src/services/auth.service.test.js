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

describe('session prefetch at boot', () => {
    const session = (name) => ({ data: { user: { id: name, name } } })

    it('serves the first session read from the prefetch and later reads fresh', async () => {
        const getSession = vi.fn().mockResolvedValueOnce(session('boot')).mockResolvedValue(session('fresh'))
        const service = createAuthService({ legacyClient: { getSession } })
        service.prefetchSession()
        service.prefetchSession()
        expect(getSession).toHaveBeenCalledOnce()

        await expect(service.getSession()).resolves.toEqual(session('boot').data)
        await expect(service.getSession()).resolves.toEqual(session('fresh').data)
        expect(getSession).toHaveBeenCalledTimes(2)
    })

    it('discards an unused prefetch when the user signs out', async () => {
        const getSession = vi.fn().mockResolvedValueOnce(session('boot')).mockResolvedValue({ data: null })
        const signOut = vi.fn().mockResolvedValue({})
        const service = createAuthService({ legacyClient: { getSession, signOut }, clearStorage: vi.fn(async () => {}) })
        service.prefetchSession()
        await service.signOut()

        await expect(service.getSession()).resolves.toBeNull()
        expect(getSession).toHaveBeenCalledTimes(2)
    })
})

describe('own password management', () => {
    it('lists linked sign-in methods and treats a missing payload as none', async () => {
        const accounts = [{ providerId: 'credential' }, { providerId: 'google' }]
        const listAccounts = vi.fn().mockResolvedValueOnce({ data: accounts, error: null }).mockResolvedValueOnce({ data: null, error: null })
        const service = createAuthService({ legacyClient: { listAccounts } })

        await expect(service.listAccounts()).resolves.toEqual(accounts)
        await expect(service.listAccounts()).resolves.toEqual([])
    })

    it('changes the password and always signs other devices out', async () => {
        const changePassword = vi.fn().mockResolvedValue({ data: { token: 'baru' }, error: null })
        const service = createAuthService({ legacyClient: { changePassword } })

        await service.changePassword('lama-sintetis', 'baru-sintetis')
        expect(changePassword).toHaveBeenCalledExactlyOnceWith({
            currentPassword: 'lama-sintetis', newPassword: 'baru-sintetis', revokeOtherSessions: true,
        })
    })

    it('keeps the Better Auth error code for a wrong current password', async () => {
        const changePassword = vi.fn().mockResolvedValue({
            data: null, error: { code: 'INVALID_PASSWORD', message: 'Invalid password', status: 400 },
        })
        const service = createAuthService({ legacyClient: { changePassword } })

        await expect(service.changePassword('salah', 'baru-sintetis')).rejects.toMatchObject({ code: 'INVALID_PASSWORD', status: 400 })
    })
})
