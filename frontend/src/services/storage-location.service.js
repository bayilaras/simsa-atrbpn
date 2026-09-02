import api from './api';

const BASE_URL = '/api/storage-locations';

function requireUnitKerjaId(unitKerjaId) {
    const unit = typeof unitKerjaId === 'string' ? unitKerjaId.trim() : '';
    if (!unit) throw new Error('unitKerjaId wajib dipilih untuk mengelola lokasi penyimpanan');
    return unit;
}

function scopedPath(path, unitKerjaId) {
    return `${path}?unitKerjaId=${encodeURIComponent(requireUnitKerjaId(unitKerjaId))}`;
}

export const storageLocationService = {
    /**
     * Get all storage locations with pagination
     */
    getAll: async (params = {}) => {
        // Read endpoints return the full { success, data, pagination } envelope,
        // matching arsip.service.js and what the pages check.
        return await api.get(BASE_URL, { ...params, unitKerjaId: requireUnitKerjaId(params.unitKerjaId) });
    },

    /**
     * Get storage locations as hierarchical tree
     */
    getTree: async (unitKerjaId) => {
        return await api.get(`${BASE_URL}/tree`, { unitKerjaId: requireUnitKerjaId(unitKerjaId) });
    },

    /**
     * Get single storage location by ID
     */
    getById: async (id, unitKerjaId) => {
        const response = await api.get(`${BASE_URL}/${id}`, { unitKerjaId: requireUnitKerjaId(unitKerjaId) });
        return response.data;
    },

    /**
     * Create new storage location
     */
    create: async (data) => {
        const response = await api.post(BASE_URL, {
            ...data,
            unitKerjaId: requireUnitKerjaId(data?.unitKerjaId),
        });
        return response.data;
    },

    /**
     * Update storage location
     */
    update: async (id, data, unitKerjaId) => {
        const response = await api.put(scopedPath(`${BASE_URL}/${id}`, unitKerjaId), data);
        return response.data;
    },

    /**
     * Delete storage location
     */
    delete: async (id, unitKerjaId) => {
        const response = await api.delete(scopedPath(`${BASE_URL}/${id}`, unitKerjaId));
        return response.data;
    },

    /**
     * Generate QR code for storage location
     */
    generateQR: async (id, unitKerjaId) => {
        return await api.get(`${BASE_URL}/${id}/qr`, { unitKerjaId: requireUnitKerjaId(unitKerjaId) });
    },
};

export default storageLocationService;
