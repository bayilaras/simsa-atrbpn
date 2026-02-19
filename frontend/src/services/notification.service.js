import api from './api';

export const notificationService = {
    getAll: (params) => api.get('/api/notifications', params),

    getCount: (params) => api.get('/api/notifications/count', params),

    getSuratMasuk: (params) => api.get('/api/notifications/surat-masuk', params),

    getArsip: (params) => api.get('/api/notifications/arsip', params),

    markAsRead: (id) => api.request(`/api/notifications/${id}/read`, { method: 'PATCH' }),

    markAllAsRead: (notificationIds) => api.request('/api/notifications/read-all', {
        method: 'PATCH',
        body: { notificationIds }
    }),
};
