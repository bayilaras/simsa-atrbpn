import api from './api';

export const suratKeluarService = {
    // List surat keluar with pagination and filters
    async getAll({ unitKerjaId, tahun, naskahDinas, search, page = 1, limit = 20 } = {}) {
        const response = await api.get('/api/surat-keluar', {
            unitKerjaId,
            tahun,
            naskahDinas,
            search,
            page,
            limit,
        });
        return response;
    },

    // Get single surat keluar by ID
    async getById(id) {
        const response = await api.get(`/api/surat-keluar/${id}`);
        return response.data;
    },

    // Get next number for new surat
    async getNextNumber({ unitKerjaId, tahun } = {}) {
        const response = await api.get('/api/surat-keluar/next-number', { unitKerjaId, tahun });
        return response.data.nextNumber;
    },

    // Get statistics
    async getStats({ unitKerjaId, tahun } = {}) {
        const response = await api.get('/api/surat-keluar/stats', { unitKerjaId, tahun });
        return response.data;
    },

    // Create new surat keluar (supports file upload)
    async create(data, file = null) {
        const formData = new FormData();

        // Append all data fields
        Object.keys(data).forEach(key => {
            if (data[key] !== null && data[key] !== undefined) {
                formData.append(key, data[key]);
            }
        });

        // Append file if exists
        if (file) {
            formData.append('file', file);
        }

        const response = await api.request('/api/surat-keluar', {
            method: 'POST',
            body: formData,
        });

        return response;
    },

    // Update surat keluar (supports file upload)
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
            const response = await api.request(`/api/surat-keluar/${id}`, {
                method: 'PUT',
                body: formData,
            });
            return response.data;
        }
        const response = await api.put(`/api/surat-keluar/${id}`, data);
        return response.data;
    },

    // Delete surat keluar
    async delete(id) {
        await api.delete(`/api/surat-keluar/${id}`);
    },

    // Archive surat keluar (creates arsip record with full metadata)
    async archive(id, metadata = {}) {
        const response = await api.post(`/api/surat-keluar/${id}/archive-full`, metadata);
        return response.data;
    },
};

export default suratKeluarService;
