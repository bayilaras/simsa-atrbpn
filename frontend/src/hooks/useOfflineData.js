import { useState, useEffect, useCallback } from 'react';
import { isOnline, onConnectivityChange } from '@/lib/offline-storage';

/**
 * Hook for handling data with offline support
 * @param {Function} fetchFn - Function to fetch data online
 * @param {Object} offlineStore - Offline storage object (e.g., suratMasukOffline)
 * @param {Object} options - Additional options
 */
export function useOfflineData(fetchFn, offlineStore, options = {}) {
    const {
        cacheKey = 'default',
        autoFetch = true,
        staleTime = 5 * 60 * 1000 // 5 minutes
    } = options;

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isFromCache, setIsFromCache] = useState(false);
    const [lastFetched, setLastFetched] = useState(null);
    const [online, setOnline] = useState(isOnline());

    // Load cached data
    const loadFromCache = useCallback(async () => {
        try {
            const cached = await offlineStore.getAll();
            if (cached && cached.length > 0) {
                setData(cached);
                setIsFromCache(true);
                const lastCached = await offlineStore.getLastCached();
                setLastFetched(lastCached);
            }
        } catch (err) {
            console.warn('Failed to load from cache:', err);
        }
    }, [offlineStore]);

    // Fetch fresh data
    const fetchData = useCallback(async (force = false) => {
        // Check if cache is still fresh
        if (!force && lastFetched && Date.now() - lastFetched < staleTime) {
            return;
        }

        if (!isOnline()) {
            // Load from cache if offline
            await loadFromCache();
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const result = await fetchFn();
            const items = result.data || result;

            setData(items);
            setIsFromCache(false);
            setLastFetched(Date.now());

            // Cache the data for offline use
            if (offlineStore && items?.length > 0) {
                await offlineStore.cache(items);
            }
        } catch (err) {
            console.error('Fetch error:', err);
            setError(err.message || 'Failed to fetch data');

            // Fallback to cache on error
            await loadFromCache();
        } finally {
            setLoading(false);
        }
    }, [fetchFn, offlineStore, lastFetched, staleTime, loadFromCache]);

    // Initial load
    useEffect(() => {
        if (autoFetch) {
            // First try to load from cache for instant UI
            loadFromCache().then(() => {
                // Then fetch fresh data in background
                fetchData();
            });
        }
    }, [autoFetch, loadFromCache, fetchData]);

    // Listen for connectivity changes
    useEffect(() => {
        const cleanup = onConnectivityChange((isNowOnline) => {
            setOnline(isNowOnline);
            if (isNowOnline) {
                // Refetch when back online
                fetchData(true);
            }
        });
        return cleanup;
    }, [fetchData]);

    return {
        data,
        loading,
        error,
        isFromCache,
        lastFetched,
        online,
        refetch: () => fetchData(true),
        refresh: () => fetchData(true)
    };
}

/**
 * Hook for single cached value (like dashboard stats)
 */
export function useOfflineValue(fetchFn, cacheStore, cacheKey, options = {}) {
    const { staleTime = 5 * 60 * 1000 } = options;

    const [value, setValue] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isFromCache, setIsFromCache] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);

        // Try to get from cache first
        try {
            const cached = await cacheStore.get(cacheKey);
            if (cached) {
                setValue(cached);
                setIsFromCache(true);
            }
        } catch (err) {
            console.warn('Cache read error:', err);
        }

        // Fetch fresh if online
        if (isOnline()) {
            try {
                const result = await fetchFn();
                setValue(result);
                setIsFromCache(false);
                await cacheStore.cache(cacheKey, result);
            } catch (err) {
                console.error('Fetch error:', err);
            }
        }

        setLoading(false);
    }, [fetchFn, cacheStore, cacheKey]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        const cleanup = onConnectivityChange((isNowOnline) => {
            if (isNowOnline) {
                load();
            }
        });
        return cleanup;
    }, [load]);

    return { value, loading, isFromCache, refetch: load };
}

export default useOfflineData;
