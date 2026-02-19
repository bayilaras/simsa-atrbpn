import api from './api';

export const klasifikasiService = {
    /**
     * Get all klasifikasi arsip
     * @param {object} params - { tipe, search, format }
     */
    async getAll(params = {}) {
        const response = await api.get('/api/klasifikasi', params);
        return response;
    },

    /**
     * Get klasifikasi tree
     * @param {string} tipe - fasilitatif or substantif
     */
    async getTree(tipe) {
        const response = await api.get('/api/klasifikasi', { format: 'tree', tipe });
        return response;
    },

    /**
     * Get klasifikasi by kode
     * @param {string} kode
     */
    async getByKode(kode) {
        const response = await api.get(`/api/klasifikasi/${kode}`);
        return response;
    },

    /**
     * Get klasifikasi statistics
     */
    async getStats() {
        const response = await api.get('/api/klasifikasi/stats');
        return response;
    },

    /**
     * Create new klasifikasi
     * @param {object} data
     */
    async create(data) {
        const response = await api.post('/api/klasifikasi', data);
        return response;
    },

    /**
     * Update klasifikasi
     * @param {string} kode
     * @param {object} data
     */
    async update(kode, data) {
        const response = await api.put(`/api/klasifikasi/${kode}`, data);
        return response;
    },

    /**
     * Delete klasifikasi
     * @param {string} kode
     */
    async delete(kode) {
        const response = await api.delete(`/api/klasifikasi/${kode}`);
        return response;
    },
};

export default klasifikasiService;
