import { useState, useEffect, useCallback } from 'react';
import { isOnline, onConnectivityChange } from '@/lib/offline-storage';

const OFFLINE_MESSAGE = 'Mode offline untuk data arsip dinonaktifkan demi keamanan. Sambungkan kembali ke jaringan.';

/**
 * Network-only data hook retained under its historical name for compatibility.
 * The offlineStore argument is deliberately ignored: sensitive records are never
 * persisted to IndexedDB or restored across sessions.
 */
export function useOfflineData(fetchFn, _offlineStore, options = {}) {
    const { autoFetch = true } = options;
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastFetched, setLastFetched] = useState(null);
    const [online, setOnline] = useState(isOnline());

    const fetchData = useCallback(async () => {
        if (!isOnline()) {
            setData(null);
            setError(OFFLINE_MESSAGE);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const result = await fetchFn();
            setData(result.data || result);
            setLastFetched(Date.now());
        } catch (err) {
            console.error('Fetch error:', err);
            setData(null);
            setError(err.message || 'Failed to fetch data');
        } finally {
            setLoading(false);
        }
    }, [fetchFn]);

    useEffect(() => {
        if (autoFetch) {
            void fetchData();
        }
    }, [autoFetch, fetchData]);

    useEffect(() => onConnectivityChange((isNowOnline) => {
        setOnline(isNowOnline);
        if (isNowOnline) {
            void fetchData();
        } else {
            setData(null);
            setError(OFFLINE_MESSAGE);
        }
    }), [fetchData]);

    return {
        data,
        loading,
        error,
        isFromCache: false,
        lastFetched,
        online,
        refetch: fetchData,
        refresh: fetchData,
    };
}

/** Network-only variant for single values such as dashboard statistics. */
export function useOfflineValue(fetchFn) {
    const [value, setValue] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        if (!isOnline()) {
            setValue(null);
            setError(OFFLINE_MESSAGE);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            setValue(await fetchFn());
        } catch (err) {
            console.error('Fetch error:', err);
            setValue(null);
            setError(err.message || 'Failed to fetch data');
        } finally {
            setLoading(false);
        }
    }, [fetchFn]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => onConnectivityChange((isNowOnline) => {
        if (isNowOnline) {
            void load();
        } else {
            setValue(null);
            setError(OFFLINE_MESSAGE);
        }
    }), [load]);

    return { value, loading, error, isFromCache: false, refetch: load };
}

export default useOfflineData;
