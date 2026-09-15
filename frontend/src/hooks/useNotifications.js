import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { notificationService } from '../services/notification.service'
import settingsService, { PREFERENCES_CHANGED_EVENT } from '../services/settings.service'
import { notificationMatchesFilter } from '../lib/notification-routing'

const EMPTY_COUNTS = {
    total: 0, urgent: 0, warning: 0, info: 0,
    suratMasuk: 0, arsipRetensi: 0, distribusi: 0,
    verifikasiRetensi: 0, appraisal: 0, penyusutan: 0,
    penyerahanPermanen: 0,
}
const CATEGORY_COUNT_KEYS = {
    'surat-masuk': 'suratMasuk',
    'arsip-retensi': 'arsipRetensi',
    distribusi: 'distribusi',
    'verifikasi-retensi': 'verifikasiRetensi',
    appraisal: 'appraisal',
    penyusutan: 'penyusutan',
    'penyerahan-permanen': 'penyerahanPermanen',
}

/**
 * Hook for fetching notifications from the API
 * Supports direct categories plus the grouped 'workflow' filter.
 * @param {Object} options
 * @param {string} options.unitKerjaId - Unit kerja ID
 * @param {number} options.limit - Max notifications to fetch
 * @param {number} options.refreshInterval - Auto-refresh interval in ms (default: 60000)
 */
export function useNotifications({ unitKerjaId = '', limit = 20, refreshInterval = 60000 } = {}) {
    const [notifications, setNotifications] = useState([])
    const [counts, setCounts] = useState(EMPTY_COUNTS)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [notificationsEnabled, setNotificationsEnabled] = useState(null)
    const scope = useMemo(() => ({ unitKerjaId, limit, notificationsEnabled }), [unitKerjaId, limit, notificationsEnabled])
    const activeScope = useRef(null)
    const requestVersion = useRef(0)
    const [loadedScope, setLoadedScope] = useState(null)
    const visibleNotifications = loadedScope === scope ? notifications : []
    const visibleCounts = loadedScope === scope ? counts : EMPTY_COUNTS

    useEffect(() => {
        activeScope.current = scope
        return () => { activeScope.current = null; requestVersion.current += 1 }
    }, [scope])

    useEffect(() => {
        let active = true
        const loadPreferences = async () => {
            try {
                const preferences = await settingsService.getPreferences()
                if (active) setNotificationsEnabled(preferences.notificationsEnabled !== false)
            } catch {
                // A preference lookup must never make operational notifications
                // disappear. Keep the legacy enabled behaviour on failure.
                if (active) setNotificationsEnabled(true)
            }
        }
        const handlePreferencesChanged = (event) => {
            setNotificationsEnabled(event.detail?.notificationsEnabled !== false)
        }

        loadPreferences()
        window.addEventListener(PREFERENCES_CHANGED_EVENT, handlePreferencesChanged)
        return () => {
            active = false
            window.removeEventListener(PREFERENCES_CHANGED_EVENT, handlePreferencesChanged)
        }
    }, [])

    const fetchNotifications = useCallback(async () => {
        if (activeScope.current !== scope) return
        const version = ++requestVersion.current
        const current = () => activeScope.current === scope && version === requestVersion.current
        if (!unitKerjaId) {
            setNotifications([])
            setCounts(EMPTY_COUNTS)
            setError(null)
            setLoading(false)
            return
        }
        if (notificationsEnabled !== true) {
            if (notificationsEnabled === false) {
                setNotifications([])
                setCounts(EMPTY_COUNTS)
                setError(null)
            }
            setLoading(false)
            return
        }
        try {
            setLoading(true)
            setError(null)
            const data = await notificationService.getAll({ unitKerjaId, limit })
            if (!current()) return
            setNotifications(data.notifications || [])
            setCounts(data.counts || EMPTY_COUNTS)
            setLoadedScope(scope)
        } catch (err) {
            if (!current()) return
            console.error('Error fetching notifications:', err)
            setError(err.message)
        } finally {
            if (current()) setLoading(false)
        }
    }, [unitKerjaId, limit, notificationsEnabled, scope])

    // Initial fetch
    useEffect(() => {
        fetchNotifications()
    }, [fetchNotifications])

    // Auto-refresh
    useEffect(() => {
        if (refreshInterval <= 0 || notificationsEnabled !== true || !unitKerjaId) return

        const interval = setInterval(() => {
            fetchNotifications()
        }, refreshInterval)

        return () => clearInterval(interval)
    }, [refreshInterval, fetchNotifications, notificationsEnabled, unitKerjaId])

    const refresh = useCallback(() => {
        setLoading(true)
        fetchNotifications()
    }, [fetchNotifications])

    const markAsRead = useCallback(async (id) => {
        if (activeScope.current !== scope) return
        if (!unitKerjaId) {
            setError('Pilih unit kerja sebelum mengelola notifikasi')
            return
        }
        // Optimistic update - find the notification to update counts properly
        if (loadedScope !== scope) return
        requestVersion.current += 1
        const notif = notifications.find(n => n.id === id)
        setNotifications(prev => prev.filter(n => n.id !== id))
        if (notif) {
            setCounts(prev => {
                const categoryCountKey = CATEGORY_COUNT_KEYS[notif.category]
                return {
                    ...prev,
                    total: Math.max(0, prev.total - 1),
                    [notif.type]: Math.max(0, (prev[notif.type] || 0) - 1),
                    ...(categoryCountKey && {
                        [categoryCountKey]: Math.max(0, (prev[categoryCountKey] || 0) - 1),
                    }),
                }
            })
        }

        try {
            await notificationService.markAsRead(id, unitKerjaId)
            if (activeScope.current !== scope) return

            // Sync accurate counts
            fetchNotifications()
        } catch (err) {
            if (activeScope.current !== scope) return
            console.error('Error marking notification as read:', err)
            // Re-sync first so the optimistic removal is rolled back, then surface the error
            await fetchNotifications()
            if (activeScope.current === scope) setError(err.message || 'Gagal menandai notifikasi sebagai dibaca')
        }
    }, [notifications, fetchNotifications, unitKerjaId, scope, loadedScope])

    const markAllAsRead = useCallback(async (categoryFilter) => {
        if (activeScope.current !== scope) return
        if (!unitKerjaId) {
            setError('Pilih unit kerja sebelum mengelola notifikasi')
            return
        }
        if (loadedScope !== scope) return
        // If categoryFilter provided, only mark visible category as read
        const targetNotifications = categoryFilter
            ? notifications.filter(n => notificationMatchesFilter(n, categoryFilter))
            : notifications
        const ids = targetNotifications.map(n => n.id)
        if (ids.length === 0) return
        requestVersion.current += 1

        // Optimistic update
        if (categoryFilter) {
            setNotifications(prev => prev.filter(n => !notificationMatchesFilter(n, categoryFilter)))
            setCounts(prev => {
                const next = { ...prev, total: Math.max(0, prev.total - ids.length) }
                for (const notification of targetNotifications) {
                    const countKey = CATEGORY_COUNT_KEYS[notification.category]
                    if (countKey) next[countKey] = Math.max(0, (next[countKey] || 0) - 1)
                    if (notification.type) {
                        next[notification.type] = Math.max(0, (next[notification.type] || 0) - 1)
                    }
                }
                return next
            })
        } else {
            setNotifications([])
            setCounts(EMPTY_COUNTS)
        }

        try {
            await notificationService.markAllAsRead(ids, unitKerjaId)
            if (activeScope.current !== scope) return

            fetchNotifications()
        } catch (err) {
            if (activeScope.current !== scope) return
            console.error('Error marking all as read:', err)
            // Re-sync first so the optimistic removal is rolled back, then surface the error
            await fetchNotifications()
            if (activeScope.current === scope) setError(err.message || 'Gagal menandai semua notifikasi sebagai dibaca')
        }
    }, [notifications, fetchNotifications, unitKerjaId, scope, loadedScope])

    // Helper to get notifications filtered by category
    const getByCategory = useCallback((category) => {
        return loadedScope === scope ? notifications.filter(n => notificationMatchesFilter(n, category)) : []
    }, [notifications, loadedScope, scope])

    return {
        notifications: visibleNotifications,
        counts: visibleCounts,
        loading,
        error,
        refresh,
        markAsRead,
        markAllAsRead,
        getByCategory,
        hasNotifications: visibleCounts.total > 0,
        hasUrgent: visibleCounts.urgent > 0,
        notificationsEnabled: notificationsEnabled !== false,
        suratCount: visibleCounts.suratMasuk,
        arsipCount: visibleCounts.arsipRetensi,
        workflowCount: (visibleCounts.distribusi || 0)
            + (visibleCounts.verifikasiRetensi || 0)
            + (visibleCounts.appraisal || 0)
            + (visibleCounts.penyusutan || 0)
            + (visibleCounts.penyerahanPermanen || 0),
    }
}
