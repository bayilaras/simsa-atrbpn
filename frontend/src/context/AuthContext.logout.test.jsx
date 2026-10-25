import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'

const service = vi.hoisted(() => ({ getSession: vi.fn(), signOut: vi.fn() }))
vi.mock('../services/auth.service', () => ({ authService: service }))
vi.mock('../lib/offline-storage', () => ({ clearOfflineStorage: vi.fn().mockResolvedValue({}) }))
let auth
const session = { user: { id: 'test-user', role: 'super_admin', unitKerjaId: 'unit-test' } }
function Probe() {
    const current = useAuth()
    useEffect(() => { auth = current }, [current])
    return <p>{current.loading ? 'Menunggu server' : current.user ? 'Halaman pribadi' : 'Form login'}</p>
}
function deferred() {
    let resolve
    const promise = new Promise(done => { resolve = done })
    return { promise, resolve }
}
beforeEach(() => { vi.resetAllMocks(); service.getSession.mockResolvedValue(session) })
afterEach(() => vi.restoreAllMocks())

describe('logout completion boundary', () => {
    it('clears local user but holds login until the remote logout completes', async () => {
        const remote = deferred()
        service.signOut.mockReturnValue(remote.promise)
        render(<AuthProvider><Probe /></AuthProvider>)
        await screen.findByText('Halaman pribadi')
        let pending
        act(() => { pending = auth.signOut() })
        expect(auth.user).toBeNull()
        expect(auth.loading).toBe(true)
        expect(auth.signingOut).toBe(true)
        expect(screen.queryByText('Form login')).not.toBeInTheDocument()
        await act(async () => { await auth.checkAuth() })
        expect(service.getSession).toHaveBeenCalledOnce()
        await act(async () => { remote.resolve(); await pending })
        expect(screen.getByText('Form login')).toBeInTheDocument()
        expect(auth.signingOut).toBe(false)
    })
    it('ignores a stale session recheck without releasing the logout loading state', async () => {
        const recheck = deferred()
        const remote = deferred()
        service.signOut.mockReturnValue(remote.promise)
        render(<AuthProvider><Probe /></AuthProvider>)
        await screen.findByText('Halaman pribadi')
        service.getSession.mockReturnValueOnce(recheck.promise)
        let checking, logout
        act(() => { checking = auth.checkAuth() })
        act(() => { logout = auth.signOut() })
        await act(async () => { recheck.resolve(session); await checking })
        expect(auth.user).toBeNull()
        expect(auth.loading).toBe(true)
        await act(async () => { remote.resolve(); await logout })
        expect(auth.user).toBeNull()
    })
    it('shows a retryable server-logout failure while retaining local clearance', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        service.signOut.mockRejectedValue(new Error('network failure'))
        render(<AuthProvider><Probe /></AuthProvider>)
        await screen.findByText('Halaman pribadi')
        await act(async () => { await auth.signOut() })
        expect(auth.user).toBeNull()
        expect(auth.logoutError).toMatch(/sesi server belum terkonfirmasi/i)
        expect(auth.error).toBe(auth.logoutError)
        service.signOut.mockResolvedValue(undefined)
        await act(async () => { await auth.signOut() })
        await waitFor(() => expect(auth.logoutError).toBeNull())
    })
})
