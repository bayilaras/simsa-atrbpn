import api from './api';

const BASE_URL = '/api/archive-lending';

function requireUnitKerjaId(unitKerjaId) {
    const unit = typeof unitKerjaId === 'string' ? unitKerjaId.trim() : '';
    if (!unit) throw new Error('unitKerjaId wajib dipilih untuk mengelola peminjaman arsip');
    return unit;
}

function scopedPath(path, unitKerjaId) {
    return `${path}?unitKerjaId=${encodeURIComponent(requireUnitKerjaId(unitKerjaId))}`;
}

export const archiveLendingService = {
    /**
     * Get all lending records with filters
     */
    getAll: async (params = {}) => {
        // Read endpoints return the full { success, data, pagination } envelope,
        // matching arsip.service.js and what the pages check.
        return await api.get(BASE_URL, { ...params, unitKerjaId: requireUnitKerjaId(params.unitKerjaId) });
    },

    /**
     * Get overdue lending records
     */
    getOverdue: async (unitKerjaId) => {
        return await api.get(`${BASE_URL}/overdue`, { unitKerjaId: requireUnitKerjaId(unitKerjaId) });
    },

    /**
     * Get lending statistics
     */
    getStats: async (unitKerjaId) => {
        return await api.get(`${BASE_URL}/stats`, { unitKerjaId: requireUnitKerjaId(unitKerjaId) });
    },

    /**
     * Get lending history for an arsip
     */
    getHistoryByArsip: async (arsipId, unitKerjaId) => {
        const response = await api.get(`${BASE_URL}/arsip/${arsipId}`, { unitKerjaId: requireUnitKerjaId(unitKerjaId) });
        return response.data;
    },

    /**
     * Get lending history for a storage location
     */
    getHistoryByLocation: async (locationId, unitKerjaId) => {
        const response = await api.get(`${BASE_URL}/location/${locationId}`, { unitKerjaId: requireUnitKerjaId(unitKerjaId) });
        return response.data;
    },

    /**
     * Get single lending record by ID
     */
    getById: async (id, unitKerjaId) => {
        const response = await api.get(`${BASE_URL}/${id}`, { unitKerjaId: requireUnitKerjaId(unitKerjaId) });
        return response.data;
    },

    /**
     * Borrow an archive (per-arsip or per-box)
     */
    borrow: async (data) => {
        const response = await api.post(`${BASE_URL}/borrow`, {
            ...data,
            unitKerjaId: requireUnitKerjaId(data?.unitKerjaId),
        });
        return response.data;
    },

    /**
     * Return a borrowed archive
     */
    return: async (id, unitKerjaId, notes = '') => {
        const response = await api.put(scopedPath(`${BASE_URL}/${id}/return`, unitKerjaId), { notes });
        return response.data;
    },

    /**
     * Extend due date for a lending
     */
    extend: async (id, unitKerjaId, newDueDate) => {
        const response = await api.put(scopedPath(`${BASE_URL}/${id}/extend`, unitKerjaId), { newDueDate });
        return response.data;
    },

    /**
     * Generate QR code for an arsip
     */
    generateArsipQR: async (arsipId, unitKerjaId) => {
        const response = await api.get(`${BASE_URL}/qr/arsip/${arsipId}`, { unitKerjaId: requireUnitKerjaId(unitKerjaId) });
        return response.data;
    },
};

export default archiveLendingService;
