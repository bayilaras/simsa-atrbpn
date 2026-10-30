import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/auth-client', () => ({ authClient: { getSession: mocks.getSession }, default: { getSession: mocks.getSession } }))

import { AppConfigProvider } from './AppConfigContext'
import { AuthProvider, useAuth } from './AuthContext'
import { RuntimeConfigurationGate } from '@/components/RuntimeConfigurationGate'
import { authService } from '@/services/auth.service'

const capabilities = { metadata: true, files: true, fileUploads: true, externalIntegrations: false }

function SignedIn() {
    const { user, loading } = useAuth()
    return <p>{loading ? 'Memuat sesi' : `Masuk sebagai ${user?.name || 'tamu'}`}</p>
}

function boot(provider) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ mode: 'full', syntheticDataOnly: false, authentication: { provider }, capabilities }),
    })))
    // What main.jsx does before the first render.
    authService.prefetchSession()
    return render(<AppConfigProvider><RuntimeConfigurationGate><AuthProvider><SignedIn /></AuthProvider></RuntimeConfigurationGate></AppConfigProvider>)
}

beforeEach(() => {
    mocks.getSession.mockReset().mockResolvedValue({ data: { user: { id: 'u-1', name: 'Siti', role: 'staff' } } })
})
afterEach(async () => {
    cleanup()
    vi.unstubAllGlobals()
    // The service is a module singleton; drop a prefetch nobody consumed.
    await authService.getSession()
})

describe('session prefetch during the capabilities handshake', () => {
    it('still blocks the app on a configuration mismatch after the prefetched session resolved', async () => {
        boot('another-provider')
        await waitFor(() => expect(mocks.getSession).toHaveBeenCalledOnce())
        expect(await screen.findByRole('alert')).toHaveTextContent('Konfigurasi aplikasi tidak cocok')
        expect(screen.queryByText(/Masuk sebagai/)).not.toBeInTheDocument()
        // AuthProvider never mounted, so nothing else asked for the session.
        expect(mocks.getSession).toHaveBeenCalledOnce()
    })

    it('lets AuthProvider use the prefetched session once the handshake passes', async () => {
        boot('better-auth')
        expect(await screen.findByText('Masuk sebagai Siti')).toBeInTheDocument()
        expect(mocks.getSession).toHaveBeenCalledOnce()
    })
})
