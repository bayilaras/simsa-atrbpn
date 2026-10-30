import { useEffect, useState } from 'react'

/** Returns `value` once it has stopped changing for `delayMs`, so typing sends one request. */
export function useDebouncedValue(value, delayMs = 300) {
    const [debounced, setDebounced] = useState(value)
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs)
        return () => clearTimeout(timer)
    }, [value, delayMs])
    return debounced
}
