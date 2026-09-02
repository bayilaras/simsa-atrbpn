import api from './api';

const BASE_URL = '/api/arsip-vital';

export const arsipVitalService = {
    // List all arsip vital
    async findAll(params = {}) {
        return api.get(BASE_URL, params);
    },

    // Get single arsip vital
    async findById(id) {
        return api.get(`${BASE_URL}/${id}`);
    },

    // Get statistics
    async getStats(unitKerjaId) {
        return api.get(`${BASE_URL}/stats`, { unitKerjaId });
    },

    // Get items due for review
    async getDueForReview(unitKerjaId, daysAhead = 30) {
        const response = await api.get('/api/arsip-vital/due-review', { unitKerjaId, daysAhead })
        return response.data
    },

    async printDaftar(unitKerjaId) {
        return api.get('/api/arsip-vital/print/daftar', { unitKerjaId }, { responseType: 'blob' })
    },

    // Create / designate
    async create(data) {
        return api.post(BASE_URL, data);
    },

    // Update
    async update(id, data) {
        return api.put(`${BASE_URL}/${id}`, data);
    },

    // Delete
    async delete(id) {
        return api.delete(`${BASE_URL}/${id}`);
    },
};
