import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useReducedMotion } from './use-reduced-motion'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('keeps animations disabled when the browser preference API is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(useReducedMotion)
    expect(result.current).toBe(true)
})

it('follows preference changes and releases the listener on unmount', () => {
    let change
    const removeEventListener = vi.fn()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false,
        addEventListener: (_event, listener) => { change = listener }, removeEventListener })))
    const { result, unmount } = renderHook(useReducedMotion)
    expect(result.current).toBe(false)
    act(() => change({ matches: true }))
    expect(result.current).toBe(true)
    unmount()
    expect(removeEventListener).toHaveBeenCalledWith('change', change)
})
