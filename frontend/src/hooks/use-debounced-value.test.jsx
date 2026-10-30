import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedValue } from './use-debounced-value'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useDebouncedValue', () => {
    it('settles on the last value only after the delay has passed without changes', () => {
        const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), { initialProps: { value: '' } })
        for (const value of ['a', 'ab', 'abc']) {
            rerender({ value })
            act(() => { vi.advanceTimersByTime(200) })
        }
        expect(result.current).toBe('')
        act(() => { vi.advanceTimersByTime(300) })
        expect(result.current).toBe('abc')
    })
})
