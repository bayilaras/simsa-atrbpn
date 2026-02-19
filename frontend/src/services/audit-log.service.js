import api from './api';

const auditLogService = {
    /**
     * List audit logs with filters
     */
    async listLogs(params = {}) {
        const searchParams = new URLSearchParams();
        if (params.entityType) searchParams.set('entityType', params.entityType);
        if (params.action) searchParams.set('action', params.action);
        if (params.userId) searchParams.set('userId', params.userId);
        if (params.search) searchParams.set('search', params.search);
        if (params.startDate) searchParams.set('startDate', params.startDate);
        if (params.endDate) searchParams.set('endDate', params.endDate);
        if (params.page) searchParams.set('page', String(params.page));
        if (params.limit) searchParams.set('limit', String(params.limit));

        const query = searchParams.toString();
        return api.get(`/api/audit-log${query ? `?${query}` : ''}`);
    },

    /**
     * Get entity history
     */
    async getEntityHistory(entityType, entityId) {
        return api.get(`/api/audit-log/${entityType}/${entityId}`);
    },
};

export default auditLogService;
