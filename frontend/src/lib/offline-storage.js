/**
 * Offline Storage Utility using IndexedDB (via idb library)
 * Provides caching for offline data access
 */

import { openDB } from 'idb';

const DB_NAME = 'simsa-offline-db';
const DB_VERSION = 1;

// Store names
const STORES = {
    SURAT_MASUK: 'surat-masuk',
    SURAT_KELUAR: 'surat-keluar',
    ARSIP: 'arsip',
    DASHBOARD: 'dashboard',
    USER_PREFS: 'user-prefs',
    SYNC_QUEUE: 'sync-queue'
};

// Initialize database
async function initDB() {
    return openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            // Surat Masuk store
            if (!db.objectStoreNames.contains(STORES.SURAT_MASUK)) {
                const store = db.createObjectStore(STORES.SURAT_MASUK, { keyPath: 'id' });
                store.createIndex('unitKerjaId', 'unitKerjaId');
                store.createIndex('tahun', 'tahun');
            }

            // Surat Keluar store
            if (!db.objectStoreNames.contains(STORES.SURAT_KELUAR)) {
                const store = db.createObjectStore(STORES.SURAT_KELUAR, { keyPath: 'id' });
                store.createIndex('unitKerjaId', 'unitKerjaId');
                store.createIndex('tahun', 'tahun');
            }

            // Arsip store
            if (!db.objectStoreNames.contains(STORES.ARSIP)) {
                const store = db.createObjectStore(STORES.ARSIP, { keyPath: 'id' });
                store.createIndex('unitKerjaId', 'unitKerjaId');
            }

            // Dashboard stats store (key-value)
            if (!db.objectStoreNames.contains(STORES.DASHBOARD)) {
                db.createObjectStore(STORES.DASHBOARD, { keyPath: 'key' });
            }

            // User preferences store
            if (!db.objectStoreNames.contains(STORES.USER_PREFS)) {
                db.createObjectStore(STORES.USER_PREFS, { keyPath: 'key' });
            }

            // Sync queue for offline mutations
            if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
                const store = db.createObjectStore(STORES.SYNC_QUEUE, {
                    keyPath: 'id',
                    autoIncrement: true
                });
                store.createIndex('timestamp', 'timestamp');
            }
        }
    });
}

// Singleton database instance
let dbInstance = null;

async function getDB() {
    if (!dbInstance) {
        dbInstance = await initDB();
    }
    return dbInstance;
}

// Generic CRUD operations
export const offlineStorage = {
    // Save multiple items to a store
    async saveMany(storeName, items) {
        const db = await getDB();
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);

        for (const item of items) {
            await store.put({
                ...item,
                _cachedAt: Date.now()
            });
        }

        await tx.done;
    },

    // Save single item
    async save(storeName, item) {
        const db = await getDB();
        await db.put(storeName, {
            ...item,
            _cachedAt: Date.now()
        });
    },

    // Get all items from a store
    async getAll(storeName) {
        const db = await getDB();
        return db.getAll(storeName);
    },

    // Get item by ID
    async get(storeName, id) {
        const db = await getDB();
        return db.get(storeName, id);
    },

    // Get items by index
    async getByIndex(storeName, indexName, value) {
        const db = await getDB();
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const index = store.index(indexName);
        return index.getAll(value);
    },

    // Delete item
    async delete(storeName, id) {
        const db = await getDB();
        await db.delete(storeName, id);
    },

    // Clear all items in a store
    async clear(storeName) {
        const db = await getDB();
        await db.clear(storeName);
    },

    // Get cache timestamp
    async getLastCached(storeName) {
        const items = await this.getAll(storeName);
        if (items.length === 0) return null;
        return Math.max(...items.map(i => i._cachedAt || 0));
    }
};

// Specialized storage for each data type
export const suratMasukOffline = {
    async cache(items) {
        await offlineStorage.saveMany(STORES.SURAT_MASUK, items);
    },
    async getAll() {
        return offlineStorage.getAll(STORES.SURAT_MASUK);
    },
    async getByUnitKerja(unitKerjaId) {
        return offlineStorage.getByIndex(STORES.SURAT_MASUK, 'unitKerjaId', unitKerjaId);
    },
    async getLastCached() {
        return offlineStorage.getLastCached(STORES.SURAT_MASUK);
    }
};

export const suratKeluarOffline = {
    async cache(items) {
        await offlineStorage.saveMany(STORES.SURAT_KELUAR, items);
    },
    async getAll() {
        return offlineStorage.getAll(STORES.SURAT_KELUAR);
    },
    async getByUnitKerja(unitKerjaId) {
        return offlineStorage.getByIndex(STORES.SURAT_KELUAR, 'unitKerjaId', unitKerjaId);
    },
    async getLastCached() {
        return offlineStorage.getLastCached(STORES.SURAT_KELUAR);
    }
};

export const arsipOffline = {
    async cache(items) {
        await offlineStorage.saveMany(STORES.ARSIP, items);
    },
    async getAll() {
        return offlineStorage.getAll(STORES.ARSIP);
    },
    async getByUnitKerja(unitKerjaId) {
        return offlineStorage.getByIndex(STORES.ARSIP, 'unitKerjaId', unitKerjaId);
    },
    async getLastCached() {
        return offlineStorage.getLastCached(STORES.ARSIP);
    }
};

export const dashboardOffline = {
    async cache(key, data) {
        await offlineStorage.save(STORES.DASHBOARD, { key, data, _cachedAt: Date.now() });
    },
    async get(key) {
        const result = await offlineStorage.get(STORES.DASHBOARD, key);
        return result?.data || null;
    }
};

// Sync queue for offline mutations (future enhancement)
export const syncQueue = {
    async add(action) {
        const db = await getDB();
        await db.add(STORES.SYNC_QUEUE, {
            ...action,
            timestamp: Date.now(),
            synced: false
        });
    },
    async getPending() {
        const db = await getDB();
        return db.getAll(STORES.SYNC_QUEUE);
    },
    async markSynced(id) {
        await offlineStorage.delete(STORES.SYNC_QUEUE, id);
    }
};

// Check if we're online
export function isOnline() {
    return navigator.onLine;
}

// Listen for online/offline events
export function onConnectivityChange(callback) {
    window.addEventListener('online', () => callback(true));
    window.addEventListener('offline', () => callback(false));

    // Return cleanup function
    return () => {
        window.removeEventListener('online', () => callback(true));
        window.removeEventListener('offline', () => callback(false));
    };
}

export default offlineStorage;
