export function normalizeApiBaseUrl(value, fallback = '') {
    const configured = typeof value === 'string' ? value.trim() : ''
    const selected = configured || fallback
    return selected.replace(/\/+$/, '')
}

export const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_URL)
