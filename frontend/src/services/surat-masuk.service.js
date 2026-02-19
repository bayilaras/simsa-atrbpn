import api from './api';

export const suratMasukService = {
    // List surat masuk with pagination and filters
    async getAll({ unitKerjaId, tahun, status, search, page = 1, limit = 20 } = {}) {
        const response = await api.get('/api/surat-masuk', {
            unitKerjaId,
            tahun,
            status,
            search,
            page,
            limit,
        });
        return response;
    },

    // Get single surat masuk by ID
    async getById(id) {
        const response = await api.get(`/api/surat-masuk/${id}`);
        return response.data;
    },

    // Get statistics
    async getStats({ unitKerjaId, tahun } = {}) {
        const response = await api.get('/api/surat-masuk/stats', { unitKerjaId, tahun });
        return response.data;
    },

    // Get next number
    async getNextNumber({ unitKerjaId, tahun } = {}) {
        const response = await api.get('/api/surat-masuk/next-number', { unitKerjaId, tahun });
        return response.data;
    },

    // Create new surat masuk (supports file upload)
    async create(data, file = null) {
        const formData = new FormData();

        // Append all data fields
        Object.keys(data).forEach(key => {
            if (data[key] !== null && data[key] !== undefined) {
                if (Array.isArray(data[key])) {
                    data[key].forEach(value => formData.append(key, value));
                } else {
                    formData.append(key, data[key]);
                }
            }
        });

        // Append file if exists
        if (file) {
            formData.append('file', file);
        }

        const response = await api.request('/api/surat-masuk', {
            method: 'POST',
            body: formData,
        });

        return response;
    },

    // Update surat masuk (supports file upload)
    async update(id, data, file = null) {
        if (file) {
            const formData = new FormData();
            Object.keys(data).forEach(key => {
                if (data[key] !== null && data[key] !== undefined) {
                    if (Array.isArray(data[key])) {
                        data[key].forEach(value => formData.append(key, value));
                    } else {
                        formData.append(key, data[key]);
                    }
                }
            });
            formData.append('file', file);
            const response = await api.request(`/api/surat-masuk/${id}`, {
                method: 'PUT',
                body: formData,
            });
            return response.data;
        }
        const response = await api.put(`/api/surat-masuk/${id}`, data);
        return response.data;
    },

    // Delete surat masuk
    async delete(id) {
        await api.delete(`/api/surat-masuk/${id}`);
    },

    // Archive surat masuk (creates arsip record with full metadata)
    async archive(id, metadata = {}) {
        const response = await api.post(`/api/surat-masuk/${id}/archive-full`, metadata);
        return response.data;
    },

    // Get belum dibalas (untuk pilihan Surat Keluar)
    async getBelumDibalas({ unitKerjaId } = {}) {
        const response = await api.get('/api/surat-masuk', {
            unitKerjaId,
            status: 'belum_dibalas',
            limit: 100,
        });
        return response;
    },
};

export default suratMasukService;
