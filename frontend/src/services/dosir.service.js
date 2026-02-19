import api from './api';

const BASE_URL = '/api/dosir';

const dosirService = {
    /**
     * Get all dosir with filters
     */
    async getAll(params = {}) {
        const response = await api.get(BASE_URL, { params });
        return response.data;
    },

    /**
     * Get dosir statistics
     */
    async getStats() {
        const response = await api.get(`${BASE_URL}/stats`);
        return response.data;
    },

    /**
     * Generate next kode
     */
    async generateKode() {
        const response = await api.get(`${BASE_URL}/generate-kode`);
        return response.data;
    },

    /**
     * Get single dosir with linked surat
     */
    async getById(id) {
        const response = await api.get(`${BASE_URL}/${id}`);
        return response.data;
    },

    /**
     * Get chronological timeline
     */
    async getTimeline(id) {
        const response = await api.get(`${BASE_URL}/${id}/timeline`);
        return response.data;
    },

    /**
     * Create new dosir
     */
    async create(data) {
        const response = await api.post(BASE_URL, data);
        return response.data;
    },

    /**
     * Update dosir
     */
    async update(id, data) {
        const response = await api.put(`${BASE_URL}/${id}`, data);
        return response.data;
    },

    /**
     * Delete dosir
     */
    async delete(id) {
        const response = await api.delete(`${BASE_URL}/${id}`);
        return response.data;
    },

    /**
     * Add surat to dosir
     */
    async addSurat(dosirId, type, suratId, notes = '') {
        const response = await api.post(`${BASE_URL}/${dosirId}/surat`, {
            type,
            suratId,
            notes,
        });
        return response.data;
    },

    /**
     * Remove surat from dosir
     */
    async removeSurat(dosirId, type, suratId) {
        const response = await api.delete(`${BASE_URL}/${dosirId}/surat/${type}/${suratId}`);
        return response.data;
    },
};

export default dosirService;
