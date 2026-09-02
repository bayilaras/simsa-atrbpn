/**
 * Offline connectivity utilities.
 *
 * Persistent offline storage is intentionally disabled. Surat and archival data
 * can contain restricted information and must not remain as plaintext IndexedDB
 * records on shared workstations after a user signs out or a session expires.
 *
 * The no-op store exports are kept temporarily for API compatibility with older
 * components. A future offline mode must use an approved encrypted, user-scoped
 * design with classification-aware policy and remote revocation.
 */

const LEGACY_DB_NAME = 'simsa-offline-db';
const LEGACY_CACHE_NAMES = ['api-cache'];

export const PERSISTENT_OFFLINE_STORAGE_ENABLED = false;

function deleteLegacyDatabase() {
    if (typeof indexedDB === 'undefined') {
        return Promise.resolve(false);
    }

    return new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(LEGACY_DB_NAME);
        request.onsuccess = () => resolve(true);
        request.onerror = () => resolve(false);
        request.onblocked = () => resolve(false);
    });
}

/**
 * Remove data left by the former IndexedDB/API-cache implementation.
 * Safe to call repeatedly from logout, session-expiry, and application startup.
 */
export async function clearOfflineStorage() {
    let indexedDbDeleted = false;
    let cacheDeleted = false;

    try {
        indexedDbDeleted = await deleteLegacyDatabase();
    } catch (error) {
        // Cleanup must never prevent logout or an expired-session redirect.
        console.error('Failed to delete legacy offline database:', error);
    }

    try {
        if (typeof window !== 'undefined' && 'caches' in window) {
            const results = await Promise.all(
                LEGACY_CACHE_NAMES.map((cacheName) => window.caches.delete(cacheName))
            );
            cacheDeleted = results.some(Boolean);
        }
    } catch (error) {
        console.error('Failed to clear legacy API cache:', error);
    }

    return { indexedDbDeleted, cacheDeleted };
}

// Compatibility facade: persistent reads always return empty and writes are
// discarded. This makes accidental re-use fail closed without breaking imports.
export const offlineStorage = Object.freeze({
    async saveMany() { },
    async save() { },
    async getAll() { return []; },
    async get() { return null; },
    async getByIndex() { return []; },
    async delete() { },
    async clear() { },
    async getLastCached() { return null; },
});

function createDisabledRecordStore() {
    return Object.freeze({
        async cache() { },
        async getAll() { return []; },
        async getByUnitKerja() { return []; },
        async getLastCached() { return null; },
    });
}

export const suratMasukOffline = createDisabledRecordStore();
export const suratKeluarOffline = createDisabledRecordStore();
export const arsipOffline = createDisabledRecordStore();

export const dashboardOffline = Object.freeze({
    async cache() { },
    async get() { return null; },
});

export const syncQueue = Object.freeze({
    async add() { return null; },
    async getPending() { return []; },
    async markSynced() { },
});

export function isOnline() {
    return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function onConnectivityChange(callback) {
    if (typeof window === 'undefined') {
        return () => { };
    }

    const handleOnline = () => callback(true);
    const handleOffline = () => callback(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
    };
}

// Purge plaintext data created by previous releases as soon as this module loads.
if (typeof window !== 'undefined') {
    void clearOfflineStorage();
}

export default offlineStorage;
