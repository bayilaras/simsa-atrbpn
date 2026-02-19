import api from './api';

export const arsipService = {
    // List arsip with pagination and filters
    async getAll({ unitKerjaId, jenisArsip, tahun, search, page = 1, limit = 20 } = {}) {
        const response = await api.get('/api/arsip', {
            unitKerjaId,
            jenisSurat: jenisArsip,
            tahun,
            search,
            page,
            limit,
        });
        return response;
    },

    // Get single arsip by ID
    async getById(id) {
        const response = await api.get(`/api/arsip/${id}`);
        return response.data;
    },

    // Get expiring archives
    async getExpiring({ unitKerjaId, daysAhead = 30 } = {}) {
        const response = await api.get('/api/arsip/expiring', { unitKerjaId, daysAhead });
        return response.data;
    },

    // Get statistics
    async getStats({ unitKerjaId, tahun } = {}) {
        const response = await api.get('/api/arsip/stats', { unitKerjaId, tahun });
        return response.data;
    },

    // Create new arsip
    async create(data) {
        const response = await api.post('/api/arsip', data);
        return response.data;
    },

    // Update arsip
    async update(id, data) {
        const response = await api.put(`/api/arsip/${id}`, data);
        return response.data;
    },

    // Delete arsip
    async delete(id) {
        await api.delete(`/api/arsip/${id}`);
    },
};

export default arsipService;
