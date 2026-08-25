import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    PERSISTENT_OFFLINE_STORAGE_ENABLED,
    arsipOffline,
    clearOfflineStorage,
    offlineStorage,
    suratKeluarOffline,
    suratMasukOffline,
    syncQueue,
} from './offline-storage';

describe('offline storage security', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        delete window.caches;
    });

    it('discards sensitive record writes and never returns persisted data', async () => {
        expect(PERSISTENT_OFFLINE_STORAGE_ENABLED).toBe(false);

        await suratMasukOffline.cache([{ id: 'sm-1', perihal: 'Rahasia' }]);
        await suratKeluarOffline.cache([{ id: 'sk-1', perihal: 'Rahasia' }]);
        await arsipOffline.cache([{ id: 'a-1', klasifikasiKeamanan: 'rahasia' }]);
        await offlineStorage.save('arsip', { id: 'a-2' });
        await syncQueue.add({ method: 'DELETE', entityId: 'a-1' });

        await expect(suratMasukOffline.getAll()).resolves.toEqual([]);
        await expect(suratKeluarOffline.getAll()).resolves.toEqual([]);
        await expect(arsipOffline.getAll()).resolves.toEqual([]);
        await expect(offlineStorage.get('arsip', 'a-2')).resolves.toBeNull();
        await expect(syncQueue.getPending()).resolves.toEqual([]);
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
