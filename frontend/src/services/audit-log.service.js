import api from './api';
import { unduhEkspor } from '@/lib/unduh-ekspor';

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
     * Unduh audit log sebagai Excel. `params` sama dengan penyaring daftar,
     * tanpa page/limit: berkas memuat seluruh hasil penyaring.
     */
    async exportLogs(params = {}) {
        return unduhEkspor('/api/audit-log/export/excel', {
            entityType: params.entityType,
            action: params.action,
            userId: params.userId,
            search: params.search,
            startDate: params.startDate,
            endDate: params.endDate,
        }, 'audit-log.xlsx');
    },

    /**
     * Get entity history
     */
    async getEntityHistory(entityType, entityId) {
        return api.get(`/api/audit-log/${entityType}/${entityId}`);
    },
};

export default auditLogService;
