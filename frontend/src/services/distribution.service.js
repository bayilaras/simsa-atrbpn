import api from './api';

export const distributionService = {
    /**
     * Get units that can receive distributions
     */
    async getDistributableUnits(excludeUnitId) {
        const params = excludeUnitId ? { excludeUnitId } : {};
        const response = await api.get('/api/distributions/units', params);
        return response.data;
    },

    /**
     * Get inbox (incoming distributions)
     */
    async getInbox(unitKerjaId, filters = {}) {
        const response = await api.get('/api/distributions/inbox', { unitKerjaId, ...filters });
        return response;
    },

    /**
     * Get outbox (sent distributions)
     */
    async getOutbox(unitKerjaId, filters = {}) {
        const response = await api.get('/api/distributions/outbox', { unitKerjaId, ...filters });
        return response;
    },

    /**
     * Get distribution statistics
     */
    async getStats(unitKerjaId) {
        const response = await api.get('/api/distributions/stats', { unitKerjaId });
        return response.data;
    },

    /**
     * Get distribution by ID
     */
    async getById(id) {
        const response = await api.get(`/api/distributions/${id}`);
        return response.data;
    },

    /**
     * Get distribution history for a surat
     */
    async getHistoryBySurat(suratMasukId) {
        const response = await api.get(`/api/distributions/surat/${suratMasukId}`);
        return response.data;
    },

    /**
     * Create new distribution (send surat to target unit)
     */
    async distribute(data) {
        const response = await api.post('/api/distributions', data);
        return response.data;
    },

    /**
     * Mark distribution as received
     */
    async receive(id) {
        const response = await api.put(`/api/distributions/${id}/receive`);
        return response.data;
    },

    /**
     * Mark distribution as processed
     */
    async process(id) {
        const response = await api.put(`/api/distributions/${id}/process`);
        return response.data;
    },

    /**
     * Reject distribution (return to sender)
     */
    async reject(id, reason) {
        const response = await api.put(`/api/distributions/${id}/reject`, { reason });
        return response.data;
    },
};

export default distributionService;

