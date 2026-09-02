import api from './api';

function scopedPath(path, unitKerjaId) {
    const unit = typeof unitKerjaId === 'string' ? unitKerjaId.trim() : '';
    if (!unit) throw new Error('unitKerjaId wajib dipilih untuk mengelola notifikasi');
    return `${path}?unitKerjaId=${encodeURIComponent(unit)}`;
}

export const notificationService = {
    getAll: (params) => api.get('/api/notifications', params),

    getCount: (params) => api.get('/api/notifications/count', params),

    getSuratMasuk: (params) => api.get('/api/notifications/surat-masuk', params),

    getArsip: (params) => api.get('/api/notifications/arsip', params),

    markAsRead: (id, unitKerjaId) => api.request(
        scopedPath(`/api/notifications/${encodeURIComponent(id)}/read`, unitKerjaId),
        { method: 'PATCH' },
    ),

    markAllAsRead: (notificationIds, unitKerjaId) => api.request(
        scopedPath('/api/notifications/read-all', unitKerjaId),
        {
        method: 'PATCH',
        body: { notificationIds }
        },
    ),
};
