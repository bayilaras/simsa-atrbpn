import api from './api';

export const tunjukSilangService = {
    async getAll(filters = {}) {
        const response = await api.get('/api/tunjuk-silang', filters);
        return response;
    },

    async getByEntity(entityType, entityId) {
        const response = await api.get(`/api/tunjuk-silang/${entityType}/${entityId}`);
        return response.data || response;
    },

    async getStats() {
        const response = await api.get('/api/tunjuk-silang/stats');
        return response.data || response;
    },

    async create(data) {
        const response = await api.post('/api/tunjuk-silang', data);
        return response.data || response;
    },

    async delete(id) {
        await api.delete(`/api/tunjuk-silang/${id}`);
    },
};

export default tunjukSilangService;
