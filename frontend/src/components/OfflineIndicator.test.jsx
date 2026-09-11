import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OfflineIndicator } from './OfflineIndicator'

const connection = vi.hoisted(() => ({ online: true, notify: null, cleanup: vi.fn() }))
vi.mock('@/lib/offline-storage', () => ({
    isOnline: () => connection.online,
    onConnectivityChange: callback => { connection.notify = callback; return connection.cleanup },
}))

describe('connection status feedback', () => {
    beforeEach(() => { vi.useFakeTimers(); connection.online = true; connection.cleanup.mockClear() })
    afterEach(() => { vi.useRealTimers() })

    it('announces loss of connectivity and gives the next step', () => {
        render(<OfflineIndicator />)
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
        act(() => connection.notify(false))
        expect(screen.getByRole('status')).toHaveTextContent('Koneksi terputus')
        expect(screen.getByRole('status')).toHaveTextContent('Sambungkan kembali')
    })

    it('immediately replaces a reconnection message if the connection drops again', () => {
        render(<OfflineIndicator />)
        act(() => connection.notify(false))
        act(() => connection.notify(true))
        expect(screen.getByRole('status')).toHaveTextContent('Kembali online')
        act(() => connection.notify(false))
        expect(screen.getByRole('status')).toHaveTextContent('Koneksi terputus')
        act(() => vi.advanceTimersByTime(4000))
        expect(screen.getByRole('status')).toHaveTextContent('Koneksi terputus')
    })

    it('dismisses a successful reconnection and cleans up timers on unmount', () => {
        const view = render(<OfflineIndicator />)
        act(() => connection.notify(true))
        act(() => vi.advanceTimersByTime(3000))
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
        act(() => connection.notify(true))
        view.unmount()
        expect(connection.cleanup).toHaveBeenCalledOnce()
        expect(vi.getTimerCount()).toBe(0)
    })
})
