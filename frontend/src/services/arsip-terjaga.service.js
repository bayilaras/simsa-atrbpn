import api from './api';

const BASE_URL = '/api/arsip-terjaga';

export const arsipTerjagaService = {
    // List all arsip terjaga
    async findAll(params = {}) {
        return api.get(BASE_URL, params);
    },

    // Get single arsip terjaga
    async findById(id) {
        return api.get(`${BASE_URL}/${id}`);
    },

    // Get statistics
    async getStats(unitKerjaId) {
        return api.get(`${BASE_URL}/stats`, { unitKerjaId });
    },

    // Get items due for reporting
    async getDueForReporting(unitKerjaId, daysAhead = 30) {
        return api.get(`${BASE_URL}/due-reporting`, { unitKerjaId, daysAhead });
    },

    async printDaftar() {
        // api.get does not support responseType, use api.request instead
        const response = await api.request('/api/arsip-terjaga/print/daftar', {
            method: 'GET',
            responseType: 'blob'
        })
        return response
    },

    // Generate ANRI report data
    async getLaporanANRI(unitKerjaId, tahun) {
        return api.get(`${BASE_URL}/laporan-anri`, { unitKerjaId, tahun });
    },

    // Create / designate
    async create(data) {
        return api.post(BASE_URL, data);
    },

    // Update
    async update(id, data) {
        return api.put(`${BASE_URL}/${id}`, data);
    },

    // Report to ANRI
    async markAsReported(id, nomorLaporan, tanggalPelaporan) {
        return api.put(`${BASE_URL}/${id}/report`, { nomorLaporan, tanggalPelaporan });
    },

    // Delete
    async delete(id) {
        return api.delete(`${BASE_URL}/${id}`);
    },
};
