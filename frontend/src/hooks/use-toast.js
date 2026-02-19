import { useState, useCallback } from 'react'

// Simple toast state management
let toastId = 0
let listeners = []

const toastState = {
    toasts: [],
}

function addToast(toast) {
    const id = toastId++
    const newToast = { ...toast, id }
    toastState.toasts = [...toastState.toasts, newToast]
    listeners.forEach((listener) => listener(toastState.toasts))

    // Auto dismiss after 3 seconds
    setTimeout(() => {
        dismissToast(id)
    }, toast.duration || 3000)

    return id
}

function dismissToast(id) {
    toastState.toasts = toastState.toasts.filter((t) => t.id !== id)
    listeners.forEach((listener) => listener(toastState.toasts))
}

export function useToast() {
    const [toasts, setToasts] = useState(toastState.toasts)

    useState(() => {
        listeners.push(setToasts)
        return () => {
            listeners = listeners.filter((l) => l !== setToasts)
        }
    })

    const toast = useCallback(({ title, description, variant = 'default', duration = 3000 }) => {
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
export const toast = ({ title, description, variant = 'default', duration = 3000 }) => {
    if (variant === 'destructive') {
        console.error(`[Toast Error] ${title}: ${description}`)
    } else {
        console.log(`[Toast] ${title}: ${description}`)
    }

    return addToast({ title, description, variant, duration })
}
