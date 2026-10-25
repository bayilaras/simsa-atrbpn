import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppConfigProvider } from './AppConfigContext'
import { useAppConfig } from './app-config-context'

function Probe() {
    const config = useAppConfig()
    return <pre data-testid="runtime">{JSON.stringify(config)}</pre>
}
const current = () => JSON.parse(screen.getByTestId('runtime').textContent)
afterEach(() => vi.unstubAllGlobals())

describe('full runtime capability verification', () => {
    it('checks the backend in an internal build and keeps unavailable features disabled', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
            mode: 'full', syntheticDataOnly: false,
            capabilities: { metadata: true, files: false, fileUploads: false, externalIntegrations: false },
            authentication: { googleSignIn: false },
        }) })
        vi.stubGlobal('fetch', fetchMock)
        render(<AppConfigProvider><Probe /></AppConfigProvider>)
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/capabilities'), expect.any(Object)))
        await waitFor(() => expect(current().loading).toBe(false))
        expect(current()).toMatchObject({ mode: 'full', compatible: true,
            capabilities: { metadata: true, files: false, fileUploads: false }, authentication: { googleSignIn: false } })
    })
    it('fails optional features closed before and after an unavailable backend', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
        render(<AppConfigProvider><Probe /></AppConfigProvider>)
        expect(current().capabilities.files).toBe(false)
        await waitFor(() => expect(current().loading).toBe(false))
        expect(current()).toMatchObject({ mode: 'full', capabilities: { metadata: true, files: false, fileUploads: false },
            authentication: { googleSignIn: false } })
        expect(current().configurationError).toBeTruthy()
    })
});
