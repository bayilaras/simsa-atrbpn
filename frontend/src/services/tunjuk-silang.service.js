import api from './api';

export const tunjukSilangService = {
    async getAll(filters = {}) {
        const response = await api.get('/api/tunjuk-silang', filters);
        return response;
    },

    // Tunjuk silang aktif satu dokumen: { data, subject, pagination }. `subject` dan
    // `relatedLabel` tiap baris adalah label tampilan yang sudah disaring server.
    async getByEntity(entityType, entityId) {
        const response = await api.get(`/api/tunjuk-silang/${entityType}/${entityId}`);
        return {
            data: Array.isArray(response?.data) ? response.data : [],
            subject: response?.subject || null,
            pagination: response?.pagination || null,
        };
    },

    async getStats() {
        const response = await api.get('/api/tunjuk-silang/stats');
        return response.data || response;
    },

    async create(data) {
        const response = await api.post('/api/tunjuk-silang', data);
        return response.data || response;
    },

    async cancel(id, reason) {
        await api.delete(`/api/tunjuk-silang/${id}`, { reason });
    },
};

export default tunjukSilangService;
