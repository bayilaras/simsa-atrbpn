import api from './api';
import { getDraftSessionId } from '@/lib/memory-drafts';

const API_BASE = '/api/settings';
export const PREFERENCES_CHANGED_EVENT = 'simsa-preferences-changed';

// The plain unit list is the same for every user, and many pages and hooks
// request it on mount. One request is shared for five minutes within an app
// session; sign-out and session expiry start a new session (memory-drafts),
// and creating or editing a unit drops it. Filtered requests such as
// { editable: true } are never cached, and a failed request is not reused.
const UNIT_KERJA_CACHE_MS = 5 * 60 * 1000;
let unitKerjaCache = null;

function clearUnitKerjaCache() {
    unitKerjaCache = null;
}

function getAllUnitKerja(params = {}) {
    if (params && Object.keys(params).length > 0) return api.get(`${API_BASE}/unit-kerja`, params);
    const session = getDraftSessionId();
    if (unitKerjaCache?.session === session && unitKerjaCache.expiresAt > Date.now()) {
        return unitKerjaCache.promise;
    }
    const promise = api.get(`${API_BASE}/unit-kerja`, {});
    const entry = { session, expiresAt: Date.now() + UNIT_KERJA_CACHE_MS, promise };
    unitKerjaCache = entry;
    promise.catch(() => {
        if (unitKerjaCache === entry) clearUnitKerjaCache();
    });
    return promise;
}

async function changeUnitKerja(request) {
    try {
        return await request();
    } finally {
        clearUnitKerjaCache();
    }
}

export const settingsService = {
    // Profile
    getProfile: () => api.get(`${API_BASE}/profile`),
    updateProfile: (data) => api.put(`${API_BASE}/profile`, data),

    // Unit Kerja
    getAllUnitKerja,
    getUnitKerja: (id) => api.get(`${API_BASE}/unit-kerja/${id}`),
    updateUnitKerja: (id, data) => changeUnitKerja(() => api.put(`${API_BASE}/unit-kerja/${id}`, data)),
    createUnitKerja: (data) => changeUnitKerja(() => api.post(`${API_BASE}/unit-kerja`, data)),

    // Surat Templates
    getSuratTemplates: (unitKerjaId) => api.get(`${API_BASE}/surat-templates`, { unitKerjaId }),
    updateSuratTemplates: (unitKerjaId, data) => api.put(`${API_BASE}/surat-templates`, {
        ...data,
        unitKerjaId,
    }),

    // Preferences
    getPreferences: () => api.get(`${API_BASE}/preferences`),
    updatePreferences: async (data) => {
        const preferences = await api.put(`${API_BASE}/preferences`, data);
        window.dispatchEvent(new CustomEvent(PREFERENCES_CHANGED_EVENT, { detail: preferences }));
        return preferences;
    },
};

export default settingsService;
