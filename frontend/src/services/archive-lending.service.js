import api from './api';

const BASE_URL = '/api/archive-lending';

export const archiveLendingService = {
    /**
     * Get all lending records with filters
     */
    getAll: async (params = {}) => {
        const response = await api.get(BASE_URL, params);
        return response.data;
    },

    /**
     * Get overdue lending records
     */
    getOverdue: async () => {
        const response = await api.get(`${BASE_URL}/overdue`);
        return response.data;
    },

    /**
     * Get lending statistics
     */
    getStats: async () => {
        const response = await api.get(`${BASE_URL}/stats`);
        return response.data;
    },

    /**
     * Get lending history for an arsip
     */
    getHistoryByArsip: async (arsipId) => {
        const response = await api.get(`${BASE_URL}/arsip/${arsipId}`);
        return response.data;
    },

    /**
     * Get lending history for a storage location
     */
    getHistoryByLocation: async (locationId) => {
        const response = await api.get(`${BASE_URL}/location/${locationId}`);
        return response.data;
    },

    /**
     * Get single lending record by ID
     */
    getById: async (id) => {
        const response = await api.get(`${BASE_URL}/${id}`);
        return response.data;
    },

    /**
     * Borrow an archive (per-arsip or per-box)
     */
    borrow: async (data) => {
        const response = await api.post(`${BASE_URL}/borrow`, data);
        return response.data;
    },

    /**
     * Return a borrowed archive
     */
    return: async (id, notes = '') => {
        const response = await api.put(`${BASE_URL}/${id}/return`, { notes });
        return response.data;
    },

    /**
     * Extend due date for a lending
     */
    extend: async (id, newDueDate) => {
        const response = await api.put(`${BASE_URL}/${id}/extend`, { newDueDate });
        return response.data;
    },

    /**
     * Generate QR code for an arsip
     */
    generateArsipQR: async (arsipId) => {
        const response = await api.get(`${BASE_URL}/qr/arsip/${arsipId}`);
        return response.data;
    },
};

export default archiveLendingService;
