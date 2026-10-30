import api from '@/services/api';

export const layananArsipService = {
    // One page as `{ data, pagination }`. The endpoint returns total/page/
    // limit/totalPages beside `data`, so they are moved into `pagination` here.
    getAll: async (params) => {
        const { data, page, limit, total, totalPages } = await api.get('/api/layanan-arsip', params);
        return { data: data || [], pagination: { page, limit, total, totalPages } };
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
