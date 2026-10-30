import api from './api';

export const autentikasiService = {
    // One page as `{ data, pagination }`. The endpoint returns total/page/
    // totalPages beside `data`, so they are moved into `pagination` here.
    getAll: async (params) => {
        const { data, page, total, totalPages } = await api.get('/api/autentikasi', params);
        return { data: data || [], pagination: { page, limit: params?.limit, total, totalPages } };
    },

    getById: async (id) => {
        const response = await api.get(`/api/autentikasi/${id}`);
        return response.data;
    },

    create: async (data) => {
        const response = await api.post('/api/autentikasi', data);
        return response.data;
    },

    getPdf: (id) => api.get(`/api/autentikasi/${id}/pdf`, {}, { responseType: 'blob' }),
};
