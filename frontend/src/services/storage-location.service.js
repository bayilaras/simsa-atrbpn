import api from './api';

const BASE_URL = '/api/storage-locations';

export const storageLocationService = {
    /**
     * Get all storage locations with pagination
     */
    getAll: async (params = {}) => {
        // Read endpoints return the full { success, data, pagination } envelope,
        // matching arsip.service.js and what the pages check.
        return await api.get(BASE_URL, params);
    },

    /**
     * Get storage locations as hierarchical tree
     */
    getTree: async (unitKerjaId) => {
        return await api.get(`${BASE_URL}/tree`, { unitKerjaId });
    },

    /**
     * Get single storage location by ID
     */
    getById: async (id) => {
        const response = await api.get(`${BASE_URL}/${id}`);
        return response.data;
    },

    /**
     * Create new storage location
     */
    create: async (data) => {
        const response = await api.post(BASE_URL, data);
        return response.data;
    },

    /**
     * Update storage location
     */
    update: async (id, data) => {
        const response = await api.put(`${BASE_URL}/${id}`, data);
        return response.data;
    },

    /**
     * Delete storage location
     */
    delete: async (id) => {
        const response = await api.delete(`${BASE_URL}/${id}`);
        return response.data;
    },

    /**
     * Generate QR code for storage location
     */
    generateQR: async (id) => {
        return await api.get(`${BASE_URL}/${id}/qr`);
    },
};

export default storageLocationService;
