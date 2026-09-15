import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'
const mediaQuery = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY) : null

export function useReducedMotion() {
    // Without a browser preference API, keep animation disabled.
    const [reduced, setReduced] = useState(() => mediaQuery()?.matches ?? true)
    useEffect(() => {
        const media = mediaQuery()
        if (!media) return undefined
        const update = event => setReduced(event.matches)
        if (media.addEventListener) media.addEventListener('change', update)
        else media.addListener?.(update)
        return () => {
            if (media.removeEventListener) media.removeEventListener('change', update)
            else media.removeListener?.(update)
        }
    }, [])
    return reduced
}
