import api from './api';

const API_BASE = '/api/settings';
export const PREFERENCES_CHANGED_EVENT = 'simsa-preferences-changed';

export const settingsService = {
    // Profile
    getProfile: () => api.get(`${API_BASE}/profile`),
    updateProfile: (data) => api.put(`${API_BASE}/profile`, data),

    // Unit Kerja
    getAllUnitKerja: (params = {}) => api.get(`${API_BASE}/unit-kerja`, params),
    getUnitKerja: (id) => api.get(`${API_BASE}/unit-kerja/${id}`),
    updateUnitKerja: (id, data) => api.put(`${API_BASE}/unit-kerja/${id}`, data),
    createUnitKerja: (data) => api.post(`${API_BASE}/unit-kerja`, data),

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
