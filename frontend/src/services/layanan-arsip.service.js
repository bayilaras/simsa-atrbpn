import api from '@/services/api';

export const layananArsipService = {
    getAll: async (params) => {
        const response = await api.get('/api/layanan-arsip', params);
        return response.data;
    },

    getById: async (id) => {
        const response = await api.get(`/api/layanan-arsip/${id}`);
        return response.data;
    },

    create: async (data) => {
        const response = await api.post('/api/layanan-arsip', data);
        return response.data;
    },

    updateStatus: async (id, status, notes) => {
        const response = await api.post(`/api/layanan-arsip/${id}/status`, { status, notes });
        return response.data;
    }
};
