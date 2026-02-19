import api from './api';

export const arsipElektronikService = {
    async getAll(filters = {}) {
        const response = await api.get('/api/arsip-elektronik', filters);
        return response;
    },

    async getById(id) {
        const response = await api.get(`/api/arsip-elektronik/${id}`);
        return response.data || response;
    },

    async getByArsipId(arsipId) {
        const response = await api.get(`/api/arsip-elektronik/arsip/${arsipId}`);
        return response.data || response;
    },

    async getStats() {
        const response = await api.get('/api/arsip-elektronik/stats');
        return response.data || response;
    },

    async getPending(page = 1, limit = 20) {
        const response = await api.get('/api/arsip-elektronik/pending', { page, limit });
        return response;
    },

    async create(data) {
        const response = await api.post('/api/arsip-elektronik', data);
        return response.data || response;
    },

    async update(id, data) {
        const response = await api.put(`/api/arsip-elektronik/${id}`, data);
        return response.data || response;
    },

    async verify(id, status, catatan) {
        const response = await api.post(`/api/arsip-elektronik/${id}/verify`, { status, catatan });
        return response.data || response;
    },

    async delete(id) {
        await api.delete(`/api/arsip-elektronik/${id}`);
    },
};

export default arsipElektronikService;
