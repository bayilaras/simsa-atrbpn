import { useState, useEffect } from 'react'

// Simple toast state management
let toastId = 0
let listeners = []
const MAX_TOASTS = 3
const toastTimeouts = new Map()

const toastState = {
    toasts: [],
}

function clearToastTimeout(id) {
    const timeout = toastTimeouts.get(id)
    if (timeout !== undefined) {
        clearTimeout(timeout)
        toastTimeouts.delete(id)
    }
}

function addToast(toast) {
    const id = toastId++
    const newToast = { ...toast, id }
    const nextToasts = [...toastState.toasts, newToast]
    nextToasts.slice(0, -MAX_TOASTS).forEach(item => clearToastTimeout(item.id))
    toastState.toasts = nextToasts.slice(-MAX_TOASTS)
    listeners.forEach((listener) => listener(toastState.toasts))

    // Keep feedback visible long enough to be read. Callers may pass duration: 0
    // for a persistent message that is dismissed manually.
    const resolvedDuration = toast.duration ?? (toast.variant === 'destructive' ? 10000 : 5000)
    if (resolvedDuration > 0) {
        const timeout = setTimeout(() => {
            dismissToast(id)
        }, resolvedDuration)
        toastTimeouts.set(id, timeout)
    }

    return id
}

function dismissToast(id) {
    clearToastTimeout(id)
    const nextToasts = toastState.toasts.filter((t) => t.id !== id)
    if (nextToasts.length === toastState.toasts.length) return
    toastState.toasts = nextToasts
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

    return {
        toast,
        dismiss: dismissToast,
        toasts,
    }
}

// Export toast function for direct use
export const toast = ({ title, description, variant = 'default', duration }) => {
    return addToast({ title, description, variant, duration })
}
