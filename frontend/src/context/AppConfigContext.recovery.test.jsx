import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppConfigProvider } from './AppConfigContext'
import { useAppConfig } from './app-config-context'
import { AppServiceNotice } from '@/components/AppServiceNotice'
import { RuntimeConfigurationGate } from '@/components/RuntimeConfigurationGate'

const healthy = () => ({ ok: true, json: async () => ({
    mode: 'full', syntheticDataOnly: false,
    capabilities: { metadata: true, files: true, fileUploads: true, externalIntegrations: true },
    authentication: { googleSignIn: true },
}) })
function Probe() {
    const config = useAppConfig()
    return <><pre data-testid="runtime">{JSON.stringify(config)}</pre>
        <RuntimeConfigurationGate><AppServiceNotice /></RuntimeConfigurationGate></>
}
const current = () => JSON.parse(screen.getByTestId('runtime').textContent)
const mount = async () => {
    let view
    await act(async () => { view = render(<AppConfigProvider><Probe /></AppConfigProvider>) })
    return view
}
const advance = async ms => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('recovers after the five-second deadline without a reload and keeps unverified services disabled', async () => {
    const fetchMock = vi.fn().mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })).mockResolvedValue(healthy())
    vi.stubGlobal('fetch', fetchMock)
    await mount()
    expect(current().capabilities.fileUploads).toBe(false)
    await advance(5000)
    expect(current()).toMatchObject({ loading: false, checking: false,
        capabilities: { files: false }, authentication: { googleSignIn: false } })
    expect(screen.getByRole('button', { name: 'Periksa lagi' })).toBeEnabled()
    await advance(2000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(current()).toMatchObject({ loading: false, checking: false, compatible: true,
        configurationError: null, capabilities: { fileUploads: true }, authentication: { googleSignIn: true } })
})

it('caps automatic retries and exposes a manual retry that deduplicates pending checks', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    await mount()
    await advance(7000)
    await advance(60000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    let resolve
    fetchMock.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const button = screen.getByRole('button', { name: 'Periksa lagi' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(screen.getByRole('button', { name: 'Memeriksa layanan…' })).toBeDisabled()
    expect(current()).toMatchObject({ loading: false, checking: true, capabilities: { fileUploads: false } })
    await act(async () => { resolve(healthy()) })
    expect(current().capabilities.fileUploads).toBe(true)
    expect(screen.queryByRole('button', { name: 'Periksa lagi' })).toBeNull()
})

it('rechecks on online or focus with a cooldown, and stops event rechecks after recovery', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    await mount()
    await advance(7000)
    await act(async () => {
        window.dispatchEvent(new Event('online'))
        window.dispatchEvent(new Event('focus'))
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    await advance(7000)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(fetchMock).toHaveBeenCalledTimes(6)
    await advance(23000)
    fetchMock.mockResolvedValue(healthy())
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(fetchMock).toHaveBeenCalledTimes(7)
    expect(current().compatible).toBe(true)
    await advance(60000)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(fetchMock).toHaveBeenCalledTimes(7)
})

it('keeps incompatible capabilities closed until a valid response replaces them', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({
        mode: 'full', syntheticDataOnly: false, capabilities: { metadata: true, files: false, fileUploads: true },
        authentication: { googleSignIn: true },
    }) }).mockResolvedValue(healthy())
    vi.stubGlobal('fetch', fetchMock)
    await mount()
    expect(current()).toMatchObject({ compatible: false, capabilities: { metadata: false, fileUploads: false },
        authentication: { googleSignIn: false } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Periksa lagi' })) })
    expect(current().compatible).toBe(true)
})

it('aborts an unmounted check and does not schedule another request', async () => {
    let signal
    const fetchMock = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
        signal = options.signal
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const view = await mount()
    await act(async () => { view.unmount() })
    expect(signal.aborted).toBe(true)
    await advance(60000)
    window.dispatchEvent(new Event('online'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
})
