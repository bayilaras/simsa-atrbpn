import api from './api';

const dashboardService = {
    /**
     * Get dashboard statistics
     */
    async getStats(unitKerjaId, tahun = null) {
        const params = {};
        if (unitKerjaId) params.unitKerjaId = unitKerjaId;
        if (tahun) params.tahun = tahun.toString();

        const response = await api.get('/api/dashboard/stats', params);
        return response.data;
    },

    /**
     * Get recent activity
     */
    async getRecentActivity(unitKerjaId, limit = 10) {
        const params = { limit: limit.toString() };
        if (unitKerjaId) params.unitKerjaId = unitKerjaId;

        const response = await api.get('/api/dashboard/recent', params);
        return response.data;
    },

    /**
     * Get expiring archives
     */
    async getExpiringArchives(unitKerjaId, daysAhead = 30) {
        const params = { daysAhead: daysAhead.toString() };
        if (unitKerjaId) params.unitKerjaId = unitKerjaId;

        const response = await api.get('/api/dashboard/expiring', params);
        return response.data;
    },

    /**
     * Get unit kerja comparison
     */
    async getUnitKerjaComparison(unitKerjaId, tahun = null) {
        const params = {};
        if (unitKerjaId) params.unitKerjaId = unitKerjaId;
        if (tahun) params.tahun = tahun.toString();

        const response = await api.get('/api/dashboard/comparison', params);
        return response.data;
    },
    /**
     * Get widget data (lifecycle, storage, lending, penyusutan, vital/terjaga, media)
     */
    async getWidgetData(unitKerjaId) {
        const params = {};
        if (unitKerjaId) params.unitKerjaId = unitKerjaId;

        const response = await api.get('/api/dashboard/widgets', params);
        return response.data;
    },
};

export default dashboardService;
