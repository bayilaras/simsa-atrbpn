import { useState, useEffect, useCallback } from 'react'

// Simple toast state management
let toastId = 0
let listeners = []
const MAX_TOASTS = 3

const toastState = {
    toasts: [],
}

function addToast(toast) {
    const id = toastId++
    const newToast = { ...toast, id }
    toastState.toasts = [...toastState.toasts, newToast].slice(-MAX_TOASTS)
    listeners.forEach((listener) => listener(toastState.toasts))

    // Keep feedback visible long enough to be read. Callers may pass duration: 0
    // for a persistent message that is dismissed manually.
    const resolvedDuration = toast.duration ?? (toast.variant === 'destructive' ? 10000 : 5000)
    if (resolvedDuration > 0) {
        setTimeout(() => {
            dismissToast(id)
        }, resolvedDuration)
    }

    return id
}

function dismissToast(id) {
    toastState.toasts = toastState.toasts.filter((t) => t.id !== id)
    listeners.forEach((listener) => listener(toastState.toasts))
}

export function useToast() {
    const [toasts, setToasts] = useState(toastState.toasts)

    useEffect(() => {
        listeners.push(setToasts)
        return () => {
            listeners = listeners.filter((l) => l !== setToasts)
        }
    }, [])

    const toast = useCallback(({ title, description, variant = 'default', duration }) => {
        // For now, use browser alert as fallback since Toaster component is not set up
        if (variant === 'destructive') {
            console.error(`[Toast Error] ${title}: ${description}`)
        } else {
            console.log(`[Toast] ${title}: ${description}`)
        }

        return addToast({ title, description, variant, duration })
    }, [])

    const dismiss = useCallback((id) => {
        dismissToast(id)
    }, [])

    return {
        toast,
        dismiss,
        toasts,
    }
}

// Export toast function for direct use
export const toast = ({ title, description, variant = 'default', duration }) => {
    if (variant === 'destructive') {
        console.error(`[Toast Error] ${title}: ${description}`)
    } else {
        console.log(`[Toast] ${title}: ${description}`)
    }

    return addToast({ title, description, variant, duration })
}
