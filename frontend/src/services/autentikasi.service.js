import api from './api';

export const autentikasiService = {
    getAll: async (params) => {
        const response = await api.get('/api/autentikasi', params);
        return response.data;
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
