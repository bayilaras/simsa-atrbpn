import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getPreferences: vi.fn(),
    getAll: vi.fn(),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
}))

vi.mock('../services/settings.service', () => ({
    default: { getPreferences: mocks.getPreferences },
    PREFERENCES_CHANGED_EVENT: 'simsa-preferences-changed',
}))
vi.mock('../services/notification.service', () => ({
    notificationService: {
        getAll: mocks.getAll,
        markAsRead: mocks.markAsRead,
        markAllAsRead: mocks.markAllAsRead,
    },
}))

import { useNotifications } from './useNotifications'

const notification = { id: 'notification-1', type: 'urgent', category: 'surat-masuk' }
const response = { notifications: [notification], counts: { total: 1, urgent: 1, suratMasuk: 1 } }
const emptyResponse = { notifications: [], counts: { total: 0 } }
let hidden
let online

beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    hidden = false
    online = true
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible')
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
    mocks.getPreferences.mockResolvedValue({ notificationsEnabled: true })
    mocks.getAll.mockResolvedValue(response)
    mocks.markAsRead.mockResolvedValue({})
    mocks.markAllAsRead.mockResolvedValue({})
})

afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
})

async function mount(options = {}) {
    let hook
    await act(async () => {
        hook = renderHook((props) => useNotifications(props), {
            initialProps: { unitKerjaId: 'unit-a', ...options },
        })
    })
    expect(mocks.getAll).toHaveBeenCalledOnce()
    return hook
}

async function advance(milliseconds) {
    await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds) })
}

function changePreferences(enabled) {
    window.dispatchEvent(new CustomEvent('simsa-preferences-changed', {
        detail: { notificationsEnabled: enabled },
    }))
}

describe('useNotifications automatic polling lifecycle', () => {
    it('pauses automatic requests while hidden or offline and refreshes when available again', async () => {
        await mount()
        hidden = true
        act(() => document.dispatchEvent(new Event('visibilitychange')))
        await advance(60 * 60 * 1000)
        expect(mocks.getAll).toHaveBeenCalledOnce()
        expect(vi.getTimerCount()).toBe(0)

        hidden = false
        online = false
        act(() => document.dispatchEvent(new Event('visibilitychange')))
        await advance(60 * 60 * 1000)
        expect(mocks.getAll).toHaveBeenCalledOnce()

        online = true
        await act(async () => window.dispatchEvent(new Event('online')))
        expect(mocks.getAll).toHaveBeenCalledTimes(2)
        await advance(60000)
        expect(mocks.getAll).toHaveBeenCalledTimes(3)

        online = false
        act(() => window.dispatchEvent(new Event('offline')))
        await advance(60 * 60 * 1000)
        expect(mocks.getAll).toHaveBeenCalledTimes(3)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('coalesces automatic refreshes while preserving manual refresh and mutation resync', async () => {
        const { result } = await mount()
        let resolveAutomatic
        mocks.getAll.mockImplementationOnce(() => new Promise(resolve => { resolveAutomatic = resolve }))
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'))
            window.dispatchEvent(new Event('online'))
        })
        expect(mocks.getAll).toHaveBeenCalledTimes(2)
        await advance(120000)
        expect(mocks.getAll).toHaveBeenCalledTimes(2)

        await act(async () => result.current.refresh())
        expect(mocks.getAll).toHaveBeenCalledTimes(3)
        mocks.getAll.mockResolvedValueOnce(emptyResponse)
        await act(async () => result.current.markAsRead(notification.id))
        expect(mocks.markAsRead).toHaveBeenCalledWith(notification.id, 'unit-a')
        expect(mocks.getAll).toHaveBeenCalledTimes(4)
        expect(result.current.notifications).toEqual([])

        await act(async () => resolveAutomatic(response))
        expect(result.current.notifications).toEqual([])
    })

    it('removes automatic listeners and timers when disabled or unmounted', async () => {
        const { rerender, unmount } = await mount()
        await act(async () => rerender({ unitKerjaId: 'unit-a', refreshInterval: 0 }))
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'))
            window.dispatchEvent(new Event('online'))
        })
        await advance(60 * 60 * 1000)
        expect(mocks.getAll).toHaveBeenCalledOnce()
        expect(vi.getTimerCount()).toBe(0)

        await act(async () => rerender({ unitKerjaId: 'unit-a', refreshInterval: 60000 }))
        expect(vi.getTimerCount()).toBe(1)
        unmount()
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'))
            window.dispatchEvent(new Event('online'))
        })
        await advance(60 * 60 * 1000)
        expect(mocks.getAll).toHaveBeenCalledOnce()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('stops polling and ignores a pending response when notifications are turned off', async () => {
        const { result } = await mount()
        let resolveAutomatic
        mocks.getAll.mockImplementationOnce(() => new Promise(resolve => { resolveAutomatic = resolve }))
        await advance(60000)
        expect(mocks.getAll).toHaveBeenCalledTimes(2)
        await act(async () => changePreferences(false))
        expect(result.current.notifications).toEqual([])
        expect(vi.getTimerCount()).toBe(0)

        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'))
            window.dispatchEvent(new Event('online'))
            resolveAutomatic(response)
        })
        await advance(60 * 60 * 1000)
        expect(mocks.getAll).toHaveBeenCalledTimes(2)
        expect(result.current.notifications).toEqual([])

        await act(async () => changePreferences(true))
        expect(mocks.getAll).toHaveBeenCalledTimes(3)
        expect(result.current.notifications).toEqual([notification])
        await advance(60000)
        expect(mocks.getAll).toHaveBeenCalledTimes(4)
    })

    it('starts a fresh polling scope when the selected unit changes during a request', async () => {
        const { result, rerender } = await mount()
        let resolveOldUnit
        mocks.getAll.mockImplementationOnce(() => new Promise(resolve => { resolveOldUnit = resolve }))
        await advance(60000)
        mocks.getAll.mockResolvedValue({ ...response, notifications: [{ ...notification, id: 'unit-b-notification' }] })
        await act(async () => rerender({ unitKerjaId: 'unit-b' }))
        expect(mocks.getAll).toHaveBeenCalledTimes(3)
        await act(async () => document.dispatchEvent(new Event('visibilitychange')))
        expect(mocks.getAll).toHaveBeenCalledTimes(4)
        expect(mocks.getAll).toHaveBeenLastCalledWith({ unitKerjaId: 'unit-b', limit: 20 })
        await act(async () => resolveOldUnit(response))
        expect(result.current.notifications[0].id).toBe('unit-b-notification')
    })
})
