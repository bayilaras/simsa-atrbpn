import api from './api';

const API_BASE = '/api/reports';

function requireUnitKerjaId(unitKerjaId) {
    const unit = typeof unitKerjaId === 'string' ? unitKerjaId.trim() : '';
    if (!unit) throw new Error('unitKerjaId wajib dipilih untuk memuat laporan');
    return unit;
}

function scopedParams(params = {}) {
    return { ...params, unitKerjaId: requireUnitKerjaId(params.unitKerjaId) };
}

export const reportService = {
    // Surat Masuk Report
    getSuratMasukReport: (params) => api.get(`${API_BASE}/surat-masuk`, scopedParams(params)),

    // Surat Keluar Report
    getSuratKeluarReport: (params) => api.get(`${API_BASE}/surat-keluar`, scopedParams(params)),

    // Arsip Report
    getArsipReport: (params) => api.get(`${API_BASE}/arsip`, scopedParams(params)),

    // Lending Report
    getLendingReport: (params) => api.get(`${API_BASE}/lending`, scopedParams(params)),

    // Summary Report
    getSummaryReport: (unitKerjaId, year) => api.get(`${API_BASE}/summary`, { unitKerjaId: requireUnitKerjaId(unitKerjaId), year }),

    // Export Reports
    exportReport: async (type, format, params) => {
        const blob = await api.get(`${API_BASE}/export/${type}/${format}`, scopedParams(params), {
            responseType: 'blob',
        });
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `laporan-${type}-${new Date().toISOString().split('T')[0]}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
    },
};

export default reportService;
