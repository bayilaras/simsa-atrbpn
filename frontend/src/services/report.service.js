import api from './api';

const API_BASE = '/api/reports';

export const reportService = {
    // Surat Masuk Report
    getSuratMasukReport: (params) => api.get(`${API_BASE}/surat-masuk`, params),

    // Surat Keluar Report
    getSuratKeluarReport: (params) => api.get(`${API_BASE}/surat-keluar`, params),

    // Arsip Report
    getArsipReport: (params) => api.get(`${API_BASE}/arsip`, params),

    // Lending Report
    getLendingReport: (params) => api.get(`${API_BASE}/lending`, params),

    // Summary Report
    getSummaryReport: (unitKerjaId, year) => api.get(`${API_BASE}/summary`, { unitKerjaId, year }),

    // Export Reports
    exportReport: async (type, format, params) => {
        const queryParams = new URLSearchParams(params).toString();
        const url = `${api.baseUrl}${API_BASE}/export/${type}/${format}?${queryParams}`;

        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error('Export failed');

        const blob = await response.blob();
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
