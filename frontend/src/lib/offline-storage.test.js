import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    PERSISTENT_OFFLINE_STORAGE_ENABLED,
    clearOfflineStorage,
} from './offline-storage';

describe('offline storage security', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        delete window.caches;
    });

    it('keeps persistent offline storage disabled', () => {
        expect(PERSISTENT_OFFLINE_STORAGE_ENABLED).toBe(false);
    });

    it('deletes the legacy IndexedDB database and API cache', async () => {
        const deleteDatabase = vi.fn(() => {
            const request = {};
            queueMicrotask(() => request.onsuccess?.());
            return request;
        });
        const deleteCache = vi.fn().mockResolvedValue(true);

        vi.stubGlobal('indexedDB', { deleteDatabase });
        Object.defineProperty(window, 'caches', {
            configurable: true,
            value: { delete: deleteCache },
        });

        await expect(clearOfflineStorage()).resolves.toEqual({
            indexedDbDeleted: true,
            cacheDeleted: true,
        });
        expect(deleteDatabase).toHaveBeenCalledWith('simsa-offline-db');
        expect(deleteCache).toHaveBeenCalledWith('api-cache');
    });
});
