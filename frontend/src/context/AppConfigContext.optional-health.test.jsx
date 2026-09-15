import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppConfigProvider } from './AppConfigContext'
import { useAppConfig } from './app-config-context'

vi.mock('@/lib/app-config', async importOriginal => {
    const actual = await importOriginal()
    return { ...actual, default: { ...actual.default, profile: 'integrated', features: { srikandi: true } } }
})
function Probe() {
    const config = useAppConfig()
    return <pre data-testid="runtime">{JSON.stringify(config)}</pre>
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('keeps verified core capabilities when the optional connector health check times out', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation(async (url, { signal }) => {
        if (url.endsWith('/api/capabilities')) return { ok: true, json: async () => ({
            mode: 'full', syntheticDataOnly: false,
            capabilities: { metadata: true, files: true, fileUploads: true, externalIntegrations: true },
        }) }
        return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        })
    })
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { render(<AppConfigProvider><Probe /></AppConfigProvider>) })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(JSON.parse(screen.getByTestId('runtime').textContent)).toMatchObject({
        compatible: true, loading: false, configurationError: null,
        capabilities: { fileUploads: true }, features: { srikandi: false },
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
})
