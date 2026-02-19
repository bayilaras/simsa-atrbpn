import api from './api';

const BASE_URL = '/api/storage-locations';

export const storageLocationService = {
    /**
     * Get all storage locations with pagination
     */
    getAll: async (params = {}) => {
        const response = await api.get(BASE_URL, params);
        return response.data;
    },

    /**
     * Get storage locations as hierarchical tree
     */
    getTree: async (unitKerjaId) => {
        const response = await api.get(`${BASE_URL}/tree`, { unitKerjaId });
        return response.data;
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
        const response = await api.get(`${BASE_URL}/${id}/qr`);
        return response.data;
    },
};

export default storageLocationService;
