import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast, useToast } from './use-toast'
import { Toaster } from '@/components/ui/toaster'

let createdIds
let dismiss

beforeEach(() => {
    createdIds = []
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const hook = renderHook(() => useToast())
    dismiss = hook.result.current.dismiss
})

afterEach(() => {
    act(() => { createdIds.forEach(id => dismiss(id)) })
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
})

function notify(message) {
    const id = toast(message)
    createdIds.push(id)
    return id
}

describe('toast feedback and timer lifecycle', () => {
    it('preserves visible notifications, accessibility, and manual dismissal', () => {
        render(<Toaster />)
        act(() => {
            notify({ title: 'Surat tersimpan', description: 'Berkas siap dikelola' })
            notify({ title: 'Gagal menyimpan', description: 'Silakan coba lagi', variant: 'destructive' })
        })
        expect(screen.getByRole('status')).toHaveTextContent('Surat tersimpan')
        expect(screen.getByRole('alert')).toHaveTextContent('Gagal menyimpan')
        fireEvent.click(screen.getAllByRole('button', { name: 'Tutup pemberitahuan' })[0])
        expect(screen.queryByText('Surat tersimpan')).not.toBeInTheDocument()
        expect(screen.getByRole('alert')).toHaveTextContent('Gagal menyimpan')
    })

    it('preserves default, destructive, explicit, and persistent display durations', () => {
        const hook = renderHook(() => useToast())
        act(() => {
            notify({ title: 'Default' })
            notify({ title: 'Destructive', variant: 'destructive' })
            notify({ title: 'Persistent', duration: 0 })
        })
        act(() => { vi.advanceTimersByTime(4999) })
        expect(hook.result.current.toasts.map(item => item.title)).toEqual(['Default', 'Destructive', 'Persistent'])
        act(() => { vi.advanceTimersByTime(1) })
        expect(hook.result.current.toasts.map(item => item.title)).toEqual(['Destructive', 'Persistent'])
        act(() => { vi.advanceTimersByTime(5000) })
        expect(hook.result.current.toasts.map(item => item.title)).toEqual(['Persistent'])
        act(() => { notify({ title: 'Short', duration: 20 }); vi.advanceTimersByTime(20) })
        expect(hook.result.current.toasts.map(item => item.title)).toEqual(['Persistent'])
    })

    it('cancels timers when messages are manually dismissed or displaced by newer feedback', () => {
        const hook = renderHook(() => useToast())
        act(() => {
            for (let index = 0; index < 100; index += 1) notify({ title: `Status ${index}` })
        })
        expect(hook.result.current.toasts).toHaveLength(3)
        expect(vi.getTimerCount()).toBe(3)
        act(() => { hook.result.current.toasts.forEach(item => dismiss(item.id)) })
        expect(vi.getTimerCount()).toBe(0)
        expect(hook.result.current.toasts).toHaveLength(0)
    })

    it('does not broadcast or log an already dismissed message', () => {
        let renders = 0
        renderHook(() => { renders += 1; return useToast() })
        let id
        act(() => { id = notify({ title: 'Feedback', description: 'Visible in the toaster', duration: 0 }) })
        act(() => { dismiss(id) })
        const completedRenders = renders
        act(() => { dismiss(id) })
        expect(renders).toBe(completedRenders)
        expect(console.log).not.toHaveBeenCalled()
        expect(console.error).not.toHaveBeenCalled()
    })
})
