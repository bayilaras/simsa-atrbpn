import { useState, useEffect, useCallback } from 'react'

// Use the same base URL pattern as other services
const API_BASE = import.meta.env.VITE_API_URL || ''

/**
 * Hook for fetching notifications from the API
 * Supports category-based filtering: 'all', 'surat-masuk', 'arsip-retensi'
 * @param {Object} options
 * @param {string} options.unitKerjaId - Unit kerja ID
 * @param {number} options.limit - Max notifications to fetch
 * @param {number} options.refreshInterval - Auto-refresh interval in ms (default: 60000)
 */
export function useNotifications({ unitKerjaId = 'ditjen', limit = 20, refreshInterval = 60000 } = {}) {
    const [notifications, setNotifications] = useState([])
    const [counts, setCounts] = useState({
        total: 0, urgent: 0, warning: 0, info: 0,
        suratMasuk: 0, arsipRetensi: 0
    })
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    const fetchNotifications = useCallback(async () => {
        try {
            setError(null)
            const response = await fetch(
                `${API_BASE}/api/notifications?unitKerjaId=${encodeURIComponent(unitKerjaId)}&limit=${limit}`,
                { credentials: 'include' }
            )

            if (!response.ok) {
                throw new Error('Failed to fetch notifications')
            }

            const data = await response.json()
            setNotifications(data.notifications || [])
            setCounts(data.counts || {
                total: 0, urgent: 0, warning: 0, info: 0,
                suratMasuk: 0, arsipRetensi: 0
            })
        } catch (err) {
            console.error('Error fetching notifications:', err)
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [unitKerjaId, limit])

    // Initial fetch
    useEffect(() => {
        fetchNotifications()
    }, [fetchNotifications])

    // Auto-refresh
    useEffect(() => {
        if (refreshInterval <= 0) return

        const interval = setInterval(() => {
            fetchNotifications()
        }, refreshInterval)

        return () => clearInterval(interval)
    }, [refreshInterval, fetchNotifications])

    const refresh = useCallback(() => {
        setLoading(true)
        fetchNotifications()
    }, [fetchNotifications])

    const markAsRead = useCallback(async (id) => {
        try {
            // Optimistic update - find the notification to update counts properly
            const notif = notifications.find(n => n.id === id)
            setNotifications(prev => prev.filter(n => n.id !== id))
            if (notif) {
                setCounts(prev => ({
                    ...prev,
                    total: Math.max(0, prev.total - 1),
                    [notif.type]: Math.max(0, (prev[notif.type] || 0) - 1),
                    suratMasuk: notif.category === 'surat-masuk'
                        ? Math.max(0, prev.suratMasuk - 1) : prev.suratMasuk,
                    arsipRetensi: notif.category === 'arsip-retensi'
                        ? Math.max(0, prev.arsipRetensi - 1) : prev.arsipRetensi,
                }))
            }

            await fetch(`${API_BASE}/api/notifications/${id}/read`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            })

            // Sync accurate counts
            fetchNotifications()
        } catch (err) {
            console.error('Error marking notification as read:', err)
        }
    }, [notifications, fetchNotifications])

    const markAllAsRead = useCallback(async (categoryFilter) => {
        try {
            // If categoryFilter provided, only mark visible category as read
            const targetNotifications = categoryFilter
                ? notifications.filter(n => n.category === categoryFilter)
                : notifications
            const ids = targetNotifications.map(n => n.id)
            if (ids.length === 0) return

            // Optimistic update
            if (categoryFilter) {
                setNotifications(prev => prev.filter(n => n.category !== categoryFilter))
                setCounts(prev => ({
                    ...prev,
                    total: Math.max(0, prev.total - ids.length),
                    suratMasuk: categoryFilter === 'surat-masuk' ? 0 : prev.suratMasuk,
                    arsipRetensi: categoryFilter === 'arsip-retensi' ? 0 : prev.arsipRetensi,
                }))
            } else {
                setNotifications([])
                setCounts({
                    total: 0, urgent: 0, warning: 0, info: 0,
                    suratMasuk: 0, arsipRetensi: 0
                })
            }

            await fetch(`${API_BASE}/api/notifications/read-all`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ notificationIds: ids })
            })

            fetchNotifications()
        } catch (err) {
            console.error('Error marking all as read:', err)
        }
    }, [notifications, fetchNotifications])

    // Helper to get notifications filtered by category
    const getByCategory = useCallback((category) => {
        if (!category || category === 'all') return notifications
        return notifications.filter(n => n.category === category)
    }, [notifications])

    return {
        notifications,
        counts,
        loading,
        error,
        refresh,
        markAsRead,
        markAllAsRead,
        getByCategory,
        hasNotifications: counts.total > 0,
        hasUrgent: counts.urgent > 0,
        suratCount: counts.suratMasuk,
        arsipCount: counts.arsipRetensi,
    }
}
