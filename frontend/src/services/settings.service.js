import api from './api';

const API_BASE = '/api/settings';

export const settingsService = {
    // Profile
    getProfile: () => api.get(`${API_BASE}/profile`),
    updateProfile: (data) => api.put(`${API_BASE}/profile`, data),

    // Unit Kerja
    getAllUnitKerja: () => api.get(`${API_BASE}/unit-kerja`),
    getUnitKerja: (id) => api.get(`${API_BASE}/unit-kerja/${id}`),
    updateUnitKerja: (id, data) => api.put(`${API_BASE}/unit-kerja/${id}`, data),
    createUnitKerja: (data) => api.post(`${API_BASE}/unit-kerja`, data),

    // Surat Templates
    getSuratTemplates: () => api.get(`${API_BASE}/surat-templates`),
    updateSuratTemplates: (data) => api.put(`${API_BASE}/surat-templates`, data),

    // Preferences
    getPreferences: () => api.get(`${API_BASE}/preferences`),
    updatePreferences: (data) => api.put(`${API_BASE}/preferences`, data),
};

export default settingsService;
